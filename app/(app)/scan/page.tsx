import { ArrowLeft, QrCode } from "lucide-react";
import Link from "next/link";
import { AssetScanner } from "@/components/field/asset-scanner";
import { requireDemoSession } from "@/lib/server/auth";

export default async function ScanAssetPage() {
  const session = await requireDemoSession();
  return (
    <div className="page-stack asset-scan-page">
      <nav className="breadcrumbs">
        <Link href="/my-work">
          <ArrowLeft size={14} /> Mi trabajo
        </Link>
      </nav>
      <header className="asset-scan-header">
        <span>
          <QrCode size={20} />
        </span>
        <div>
          <p className="overline">
            {session.siteCode} · Identificación contextual
          </p>
          <h1>Activo en campo</h1>
          <p>
            El código se resuelve dentro del centro activo; nunca mezcla datos
            entre plantas.
          </p>
        </div>
      </header>
      <AssetScanner />
    </div>
  );
}
