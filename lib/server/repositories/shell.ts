import type { DemoUserSession } from "../auth";
import { tenantScope } from "./shared";
import { scopedQueries } from "./scoped-queries";

export type ShellNotification = {
  id: string;
  title: string;
  body: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  createdAt: string;
};

export async function getShellNotifications(
  session: DemoUserSession,
): Promise<ShellNotification[]> {
  const { queryAll } = scopedQueries(tenantScope(session));
  return queryAll<ShellNotification>(
    `
    SELECT id, title, body, severity, created_at AS createdAt
    FROM scope_notifications
    WHERE user_id = ?
      AND organization_id = ?
      AND site_id = ?
      AND read_at IS NULL
    ORDER BY created_at DESC
    LIMIT 6
  `,
    [session.userId, session.organizationId, session.siteId],
  );
}
