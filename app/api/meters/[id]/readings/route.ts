import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { recordMeterReading } from "@/lib/server/operations/preventive";

const schema = z.object({
  value: z.number().nonnegative(),
  recordedAt: z.string().datetime(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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
            message: "La lectura o su fecha no son válidas.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const meterId = decodeURIComponent((await params).id);
    const data = await recordMeterReading(
      { session, requestId },
      meterId,
      parsed.data,
    );
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "METER_READING_FAILED",
        message: "No se ha podido registrar la lectura.",
      },
      requestId,
    );
  }
}
