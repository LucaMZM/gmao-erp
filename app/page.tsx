import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentSession } from "@/lib/server/auth";
import { applicationMode } from "@/lib/server/runtime-mode";
import { productionNeedsSetup } from "@/lib/server/production-bootstrap";
import { SetupForm } from "@/components/auth/setup-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session)
    redirect(session.roleKey === "TECHNICIAN" ? "/my-work" : "/overview");
  const demoMode = applicationMode() === "DEMO";
  const setupRequired = !demoMode && (await productionNeedsSetup());

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <span>M</span>
          <div>
            <strong>Mazmi</strong>
            <small>Factory GMAO</small>
          </div>
        </div>
        <div className="login-copy">
          <p className="overline">Mantenimiento · Activos · Fiabilidad</p>
          <h1>Bienvenido a planta.</h1>
          <p>
            {demoMode
              ? "Accede al centro operativo de Mazmi FlexPack Industries."
              : setupRequired
                ? "Aprovisiona el entorno inicial de tu organización."
                : "Accede al centro operativo de tu organización."}
          </p>
        </div>
        {setupRequired ? <SetupForm /> : <LoginForm demoMode={demoMode} />}
        <footer>
          {demoMode
            ? "Entorno demo industrial · V2B Enterprise Governance"
            : "Entorno de producción · acceso protegido"}
        </footer>
      </section>

      {demoMode ? (
        <aside className="login-atmosphere" aria-hidden="true">
          <div className="industrial-canvas">
            <div className="canvas-topline">
              <span>ES-LEV-01</span>
              <span>OPERACIÓN ESTABLE</span>
            </div>
            <div className="process-flow">
              <div className="process-rail" />
              {[
                ["01", "Impresión", "96,2%"],
                ["02", "Laminación", "88,6%"],
                ["03", "Coating", "94,1%"],
                ["04", "Corte", "97,5%"],
              ].map(([code, name, value], index) => (
                <div
                  className={
                    index === 1 ? "process-node attention" : "process-node"
                  }
                  key={code}
                >
                  <i />
                  <span>
                    <small>{code}</small>
                    <strong>{name}</strong>
                  </span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="atmosphere-card">
              <p>Disponibilidad de planta</p>
              <strong>94,8%</strong>
              <span>
                <i style={{ width: "94.8%" }} />
              </span>
              <small>Turno mañana · actualización 08:42</small>
            </div>
            <div className="atmosphere-wordmark">
              INDUSTRIAL
              <br />
              CLARITY
            </div>
          </div>
        </aside>
      ) : null}
    </main>
  );
}
