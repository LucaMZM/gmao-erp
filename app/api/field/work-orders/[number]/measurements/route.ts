import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { recordWorkOrderMeasurement } from "@/lib/server/operations/field";
import { runIdempotent } from "@/lib/server/operations/shared";

const schema = z.object({
  taskId: z.string().min(1).max(120).nullable().optional(),
  meterId: z.string().min(1).max(120).nullable().optional(),
  label: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(30),
  value: z.number().finite(),
  minimumValue: z.number().finite().nullable().optional(),
  maximumValue: z.number().finite().nullable().optional(),
  recordedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).nullable().optional(),
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
            message: "La medición no es válida.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const context = { session, requestId };
    const { value: data, replayed } = await runIdempotent(
      context,
      request.headers.get("idempotency-key"),
      "FIELD_MEASUREMENT",
      () =>
        recordWorkOrderMeasurement(
          context,
          decodeURIComponent(number),
          parsed.data,
        ),
    );
    return NextResponse.json(
      { data, replayed, requestId },
      { status: replayed ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "MEASUREMENT_FAILED",
        message: "No se ha podido registrar la medición.",
      },
      requestId,
    );
  }
}
