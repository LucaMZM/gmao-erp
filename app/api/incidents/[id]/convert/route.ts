import { NextResponse } from "next/server";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse } from "@/lib/server/http";
import { convertIncidentToWorkOrder } from "@/lib/server/operations/incidents";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const { id } = await params;
    const data = await convertIncidentToWorkOrder({ session, requestId }, id);
    return NextResponse.json({
      data: { ...data, href: `/work-orders/${data.number}` },
      requestId,
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "INCIDENT_CONVERSION_FAILED",
        message: "No se ha podido convertir la incidencia.",
      },
      requestId,
    );
  }
}
