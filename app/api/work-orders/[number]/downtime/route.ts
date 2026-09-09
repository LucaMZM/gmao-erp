import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { endDowntime, startDowntime } from "@/lib/server/operations/downtime";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("START"),
    startedAt: z.string().datetime().optional(),
    kind: z.enum(["PLANNED", "UNPLANNED"]),
    productionImpact: z.enum([
      "FULL_STOP",
      "REDUCED_SPEED",
      "MICROSTOP",
      "NO_IMPACT",
    ]),
    cause: z.string().trim().max(1_000).nullable().optional(),
  }),
  z.object({
    action: z.literal("END"),
    downtimeId: z.string().min(1).max(100),
    endedAt: z.string().datetime().optional(),
  }),
]);

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
            message: "Los datos de downtime no son válidos.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const workOrderNumber = decodeURIComponent(number);
    const context = { session, requestId };
    if (parsed.data.action === "START") {
      const data = await startDowntime(context, workOrderNumber, parsed.data);
      return NextResponse.json({ data, requestId }, { status: 201 });
    }
    await endDowntime(
      context,
      workOrderNumber,
      parsed.data.downtimeId,
      parsed.data.endedAt,
    );
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "DOWNTIME_OPERATION_FAILED",
        message: "No se ha podido registrar el downtime.",
      },
      requestId,
    );
  }
}
