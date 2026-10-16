import { notFound } from "next/navigation";
import { ImportCenter } from "@/components/imports/import-center";
import { PageHeader } from "@/components/ui/page-header";
import { requireDemoSession } from "@/lib/server/auth";

export default async function ImportsPage() {
  const session = await requireDemoSession();
  if (
    !session.permissionCodes.includes("asset.manage") &&
    !session.permissionCodes.includes("inventory.manage")
  )
    notFound();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${session.siteCode} · Puesta en marcha`}
        title="Import Center"
        description="Mapea columnas, valida sin modificar datos y confirma una carga trazable por planta."
      />
      <ImportCenter
        assetAllowed={session.permissionCodes.includes("asset.manage")}
        mroAllowed={session.permissionCodes.includes("inventory.manage")}
      />
    </div>
  );
}
