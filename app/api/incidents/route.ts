import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  reportIncident,
  resolveIncidentContext,
} from "@/lib/server/operations/incidents";
import { assertPermission } from "@/lib/domain/permissions";
import { runIdempotent } from "@/lib/server/operations/shared";

const schema = z.object({
  functionalLocationId: z.string().min(1).max(100),
  assetId: z.string().min(1).max(100).nullable().default(null),
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().min(10).max(2_000),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  initialImpact: z.enum([
    "FULL_STOP",
    "REDUCED_SPEED",
    "QUALITY_RISK",
    "SAFETY_RISK",
    "NO_IMPACT",
    "UNKNOWN",
  ]),
  origin: z
    .enum(["OPERATOR", "MAINTENANCE", "INSPECTION", "CONDITION", "SYSTEM"])
    .default("OPERATOR"),
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
            message: "Revisa los datos mínimos de la incidencia.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const context = { session, requestId };
    assertPermission(session, "INCIDENT_REPORT");
    await resolveIncidentContext(
      session,
      parsed.data.functionalLocationId,
      parsed.data.assetId,
    );
    const { value: data, replayed } = await runIdempotent(
      context,
      request.headers.get("idempotency-key"),
      "INCIDENT_REPORT",
      () => reportIncident(context, parsed.data),
      parsed.data,
    );
    return NextResponse.json(
      {
        data: { ...data, href: `/incidents/${data.number}` },
        replayed,
        requestId,
      },
      { status: replayed ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "INCIDENT_REPORT_FAILED",
        message: "No se ha podido registrar la incidencia.",
      },
      requestId,
    );
  }
}
