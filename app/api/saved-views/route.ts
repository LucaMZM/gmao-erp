import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { getD1 } from "@/db";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { ensureDatabase } from "@/lib/server/database";

const schema = z.object({
  resource: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(80),
  filters: z.record(z.unknown()),
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
            message: "La vista no es válida.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    await ensureDatabase();
    const now = new Date().toISOString();
    const id = `saved-view-${crypto.randomUUID()}`;
    await getD1()
      .prepare(
        `INSERT INTO saved_views (id, organization_id, user_id, site_id, resource, name, filters_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id, resource, name) DO UPDATE SET filters_json = excluded.filters_json,
         site_id = excluded.site_id, updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        session.organizationId,
        session.userId,
        session.siteId,
        parsed.data.resource,
        parsed.data.name,
        JSON.stringify(parsed.data.filters),
        now,
        now,
      )
      .run();
    return NextResponse.json(
      { data: { id, name: parsed.data.name }, requestId },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SAVED_VIEW_FAILED",
        message: "No se ha podido guardar la vista.",
      },
      requestId,
    );
  }
}
