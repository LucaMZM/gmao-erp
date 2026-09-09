import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { triageIncident } from "@/lib/server/operations/incidents";

const schema = z.object({
  action: z.enum(["START_TRIAGE", "REQUEST_INFO", "ACCEPT", "REJECT", "CLOSE"]),
  assetId: z.string().min(1).max(100).nullable().optional(),
  priority: z
    .enum(["P1_EMERGENCY", "P2_URGENT", "P3_HIGH", "P4_NORMAL", "P5_LOW"])
    .optional(),
  classification: z
    .enum([
      "CORRECTIVE",
      "PREVENTIVE",
      "INSPECTION",
      "PREDICTIVE",
      "CALIBRATION",
      "IMPROVEMENT",
    ])
    .optional(),
  note: z.string().trim().max(1_000).optional(),
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
            message: "La decisión de triage no es válida.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { id } = await params;
    const data = await triageIncident({ session, requestId }, id, parsed.data);
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "INCIDENT_TRIAGE_FAILED",
        message: "No se ha podido actualizar el triage.",
      },
      requestId,
    );
  }
}
