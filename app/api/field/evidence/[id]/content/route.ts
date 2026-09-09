import { getD1 } from "@/db";
import { requireApiSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { getEvidenceStorage } from "@/lib/server/file-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  await ensureDatabase();
  const { id } = await params;
  const evidence = await getD1()
    .prepare(
      `SELECT storage_key AS storageKey, file_name AS fileName,
        content_type AS contentType
       FROM evidence_items WHERE id = ? AND organization_id = ? AND site_id = ?
         AND storage_provider = 'R2' LIMIT 1`,
    )
    .bind(decodeURIComponent(id), session.organizationId, session.siteId)
    .first<{
      storageKey: string;
      fileName: string | null;
      contentType: string | null;
    }>();
  if (!evidence) return new Response("Not found", { status: 404 });
  const object = await getEvidenceStorage().get(evidence.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": evidence.contentType ?? object.contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="${(evidence.fileName ?? "evidence").replaceAll('"', "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
