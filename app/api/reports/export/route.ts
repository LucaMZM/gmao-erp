import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/domain/governance";
import { requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, ApiContractError } from "@/lib/server/http";
import {
  getReportingData,
  reportingCsv,
} from "@/lib/server/repositories/reports";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession();
    if (!hasPermission(session.permissionCodes, "reports.export")) {
      throw new ApiContractError(
        403,
        "EXPORT_FORBIDDEN",
        "Tu perfil no permite exportar informes.",
      );
    }
    const url = new URL(request.url);
    const today = new Date().toISOString().slice(0, 10);
    const from =
      url.searchParams.get("from")?.slice(0, 10) ??
      new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to")?.slice(0, 10) ?? today;
    const csv = reportingCsv(await getReportingData(session, { from, to }));
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mazmi-maintenance-${session.siteCode}-${from}-${to}.csv"`,
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "REPORT_EXPORT_FAILED",
        message: "No se ha podido exportar el informe.",
      },
      requestId,
    );
  }
}
