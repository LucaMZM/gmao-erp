import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/domain/governance";
import { requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, ApiContractError } from "@/lib/server/http";
import { listExportAssetCosts } from "@/lib/server/repositories/reports";
import { reportingCsvRows } from "@/lib/domain/reporting";

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
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(Date.parse(from)) ||
      !Number.isFinite(Date.parse(to)) ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 5 * 366 * 86_400_000
    )
      throw new ApiContractError(
        422,
        "INVALID_REPORT_PERIOD",
        "Selecciona un periodo válido de hasta cinco años.",
      );
    const filters = { from, to };
    let firstPage: Awaited<ReturnType<typeof listExportAssetCosts>> | null =
      await listExportAssetCosts(session, filters, "");
    let cursor = firstPage.at(-1)?.id ?? "";
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (firstPage) {
            controller.enqueue(
              encoder.encode(`\uFEFF${reportingCsvRows(firstPage)}\n`),
            );
            const done = firstPage.length < 200;
            firstPage = null;
            if (done) {
              controller.close();
              return;
            }
          }
          const page = await listExportAssetCosts(session, filters, cursor);
          if (!page.length) {
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(`${reportingCsvRows(page, false)}\n`),
          );
          cursor = page.at(-1)!.id;
          if (page.length < 200) controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new NextResponse(stream, {
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
