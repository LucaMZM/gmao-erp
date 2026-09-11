import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  answerChecklistTask,
  authorizeFieldReplay,
} from "@/lib/server/operations/field";
import { runIdempotent } from "@/lib/server/operations/shared";

const schema = z.object({
  taskId: z.string().min(1).max(120),
  value: z.union([z.string().max(2_000), z.number(), z.boolean()]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
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
            message: "La respuesta del checklist no es válida.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const context = { session, requestId };
    await authorizeFieldReplay(
      context,
      decodeURIComponent(number),
      "FIELD_CHECKLIST",
    );
    const { value: data, replayed } = await runIdempotent(
      context,
      request.headers.get("idempotency-key"),
      "FIELD_CHECKLIST",
      () =>
        answerChecklistTask(context, decodeURIComponent(number), parsed.data),
      { number: decodeURIComponent(number), input: parsed.data },
    );
    return NextResponse.json({ data, replayed, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "CHECKLIST_RESPONSE_FAILED",
        message: "No se ha podido guardar el paso del checklist.",
      },
      requestId,
    );
  }
}
