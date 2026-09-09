import { getD1 } from "@/db";
import { getCurrentSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { getEvidenceStorage } from "@/lib/server/file-storage";
import {
  locationScopePredicate,
  tenantScope,
} from "@/lib/server/repositories/shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  await ensureDatabase();
  const { id } = await params;
  const locationScope = locationScopePredicate(
    tenantScope(session),
    "work_order.functional_location_id",
  );
  const evidence = await getD1()
    .prepare(
      `SELECT evidence.storage_key AS storageKey,
        COALESCE(evidence.safe_file_name, evidence.file_name) AS fileName,
        content_type AS contentType
       FROM evidence_items evidence
       INNER JOIN work_orders work_order ON work_order.id = evidence.work_order_id
       WHERE evidence.id = ? AND evidence.organization_id = ?
         AND evidence.site_id = ? AND evidence.storage_provider = 'R2'
         AND (${locationScope.sql})
         AND (? <> 'TECHNICIAN' OR EXISTS (
           SELECT 1 FROM work_order_assignments assignment
           WHERE assignment.work_order_id = work_order.id
             AND assignment.user_id = ? AND assignment.unassigned_at IS NULL
         ))
       LIMIT 1`,
    )
    .bind(
      decodeURIComponent(id),
      session.organizationId,
      session.siteId,
      ...locationScope.params,
      session.roleKey,
      session.userId,
    )
    .first<{
      storageKey: string;
      fileName: string | null;
      contentType: string | null;
    }>();
  if (!evidence) return new Response("Not found", { status: 404 });
  const object = await getEvidenceStorage().get(evidence.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const fileName = (evidence.fileName ?? "evidence").replace(/[\r\n"\\]/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": evidence.contentType ?? object.contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
