import { Search, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { FacetedFilterForm } from "@/components/ui/faceted-filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/domain/governance";
import { formatDateTime } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  getAuditEntries,
  getAuditFacets,
} from "@/lib/server/repositories/governance";

function valuePreview(value: string | null) {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "audit.read"))
    redirect("/overview");
  const query = await searchParams;
  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.slice(0, 80) ?? "";
  };
  const filters = {
    actor: one("actor"),
    action: one("action"),
    entity: one("entity"),
    outcome: one("outcome"),
    from: one("from"),
    to: one("to"),
  };
  const [entries, facets] = await Promise.all([
    getAuditEntries(session, filters),
    getAuditFacets(session, filters),
  ]);
  const entityLabels: Record<string, string> = {
    SESSION: "Sesión",
    WORK_ORDER: "Orden de trabajo",
    PURCHASE_ORDER: "Pedido",
    ROOT_CAUSE_ANALYSIS: "RCA",
    MEMBERSHIP: "Acceso",
  };
  const outcomeLabels: Record<string, string> = {
    SUCCESS: "Correcto",
    DENIED: "Denegado",
    FAILURE: "Fallido",
  };
  const availableEntities = new Set(facets.entities.map((item) => item.value));
  const availableOutcomes = new Set(facets.outcomes.map((item) => item.value));
  const activeFilters = [
    filters.action
      ? { key: "action", label: `Acción: ${filters.action}` }
      : null,
    filters.entity
      ? {
          key: "entity",
          label: `Entidad: ${entityLabels[filters.entity] ?? filters.entity}`,
        }
      : null,
    filters.outcome
      ? {
          key: "outcome",
          label: `Resultado: ${outcomeLabels[filters.outcome] ?? filters.outcome}`,
        }
      : null,
    filters.from ? { key: "from", label: `Desde: ${filters.from}` } : null,
    filters.to ? { key: "to", label: `Hasta: ${filters.to}` } : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
  return (
    <div className="page-stack governance-page">
      <PageHeader
        description="Investigación append-only de cambios sensibles, accesos y decisiones operativas."
        eyebrow={`${session.siteCode} · Gobierno`}
        title="Auditoría"
      />
      <FacetedFilterForm
        activeFilters={activeFilters}
        className="filter-bar audit-filter-bar"
      >
        <Search size={15} />
        <input
          aria-label="Acción contiene"
          defaultValue={filters.action}
          name="action"
          placeholder="Acción contiene…"
        />
        <select
          aria-label="Tipo de entidad"
          defaultValue={filters.entity}
          name="entity"
        >
          <option value="">Todas las entidades</option>
          {filters.entity && !availableEntities.has(filters.entity) ? (
            <option disabled value={filters.entity}>
              {entityLabels[filters.entity] ?? filters.entity} · sin
              coincidencias
            </option>
          ) : null}
          {Object.entries(entityLabels)
            .filter(([value]) => availableEntities.has(value))
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        <select
          aria-label="Resultado"
          defaultValue={filters.outcome}
          name="outcome"
        >
          <option value="">Todos los resultados</option>
          {filters.outcome && !availableOutcomes.has(filters.outcome) ? (
            <option disabled value={filters.outcome}>
              {outcomeLabels[filters.outcome] ?? filters.outcome} · sin
              coincidencias
            </option>
          ) : null}
          {Object.entries(outcomeLabels)
            .filter(([value]) => availableOutcomes.has(value))
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        <input
          aria-label="Desde"
          defaultValue={filters.from}
          name="from"
          type="date"
        />
        <input
          aria-label="Hasta"
          defaultValue={filters.to}
          name="to"
          type="date"
        />
        <button className="secondary-button" type="submit">
          Aplicar
        </button>
      </FacetedFilterForm>
      <section
        className="data-panel audit-stream"
        aria-label="Registro de auditoría"
      >
        <div className="panel-title-row">
          <div>
            <p className="overline">Trazabilidad inmutable</p>
            <h2>{entries.length} eventos en el alcance</h2>
          </div>
          <span className="governance-seal">
            <ShieldCheck size={15} /> Solo lectura
          </span>
        </div>
        <div className="audit-list">
          {entries.map((entry) => (
            <details className="audit-entry" key={entry.id}>
              <summary>
                <span
                  className={`audit-outcome ${entry.outcome.toLowerCase()}`}
                />
                <span>
                  <strong>{entry.action.replaceAll("_", " ")}</strong>
                  <small>
                    {entry.actorName} · {entry.entityType} · {entry.entityId}
                  </small>
                </span>
                <time>{formatDateTime(entry.createdAt)}</time>
              </summary>
              <div className="audit-change-grid">
                <div>
                  <span>Anterior</span>
                  <pre>{valuePreview(entry.previousValue)}</pre>
                </div>
                <div>
                  <span>Nuevo</span>
                  <pre>{valuePreview(entry.newValue)}</pre>
                </div>
                <div>
                  <span>Contexto</span>
                  <pre>{valuePreview(entry.contextJson)}</pre>
                </div>
              </div>
              <p className="audit-request">
                Request {entry.requestId ?? "sin correlación"}
                {entry.errorCode ? ` · ${entry.errorCode}` : ""}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
