import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  createShiftHandover,
  authorizeHandover,
} from "@/lib/server/operations/field";
import { runIdempotent } from "@/lib/server/operations/shared";

const schema = z.object({
  fromShift: z.string().trim().min(1).max(40),
  toShift: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(5).max(2_000),
  risks: z.string().trim().max(1_000).nullable().optional(),
  partsPending: z.string().trim().max(1_000).nullable().optional(),
  workOrderNumbers: z.array(z.string().min(1).max(80)).max(12).default([]),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El relevo de turno no es válido.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const context = { session, requestId };
    await authorizeHandover(context, parsed.data);
    const { value: data, replayed } = await runIdempotent(
      context,
      request.headers.get("idempotency-key"),
      "SHIFT_HANDOVER_CREATE",
      () => createShiftHandover(context, parsed.data),
      parsed.data,
    );
    return NextResponse.json(
      { data, replayed, requestId },
      { status: replayed ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SHIFT_HANDOVER_FAILED",
        message: "No se ha podido guardar el relevo de turno.",
      },
      requestId,
    );
  }
}
