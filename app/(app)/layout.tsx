import { AppShell } from "@/components/shell/app-shell";
import { requireDemoSession } from "@/lib/server/auth";
import { getShellNotifications } from "@/lib/server/repositories/shell";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireDemoSession();
  const notifications = await getShellNotifications(session);
  return (
    <AppShell notifications={notifications} session={session}>
      {children}
    </AppShell>
  );
}
