"use client";

import { type ChangeEvent, useState } from "react";
import {
  importColumns,
  parseCsv,
  type ImportKind,
} from "@/lib/domain/csv-import";

type Preview = {
  hash: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; code: string; message: string }>;
  warnings: Array<{ row: number; code: string; message: string }>;
  rows: Array<{ row: number; identity: string; action: string }>;
};
type Summary = {
  jobId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: number;
  failures: Array<{ row: number; message: string }>;
};
const labels: Record<ImportKind, string> = {
  LOCATIONS: "Ubicaciones",
  ASSETS: "Activos",
  PARTS: "Recambios",
  SUPPLIERS: "Proveedores",
};
export function ImportCenter({
  assetAllowed,
  mroAllowed,
}: {
  assetAllowed: boolean;
  mroAllowed: boolean;
}) {
  const kinds = (Object.keys(labels) as ImportKind[]).filter((kind) =>
    kind === "LOCATIONS" || kind === "ASSETS" ? assetAllowed : mroAllowed,
  );
  const [kind, setKind] = useState<ImportKind>(kinds[0]);
  const [csv, setCsv] = useState(""),
    [fileName, setFileName] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null),
    [summary, setSummary] = useState<Summary | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [encoding, setEncoding] = useState("UTF-8");
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setPreview(null);
    setSummary(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("El archivo supera 2 MB. Divide la carga en lotes seguros.");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        setEncoding("UTF-8");
      } catch {
        text = new TextDecoder("windows-1252").decode(bytes);
        setEncoding("Windows-1252");
      }
      const table = parseCsv(text);
      setCsv(text);
      setFileName(file.name);
      setHeaders(table.headers);
      setMapping(
        Object.fromEntries(
          importColumns[kind].map((field) => [
            field,
            table.headers.find(
              (header) => header.toLowerCase() === field.toLowerCase(),
            ) ?? "",
          ]),
        ),
      );
    } catch {
      setError(
        "El CSV no tiene una estructura válida o contiene datos no admitidos.",
      );
    }
  }
  function selectKind(value: ImportKind) {
    setKind(value);
    setPreview(null);
    setSummary(null);
    setMapping(
      Object.fromEntries(
        importColumns[value].map((field) => [
          field,
          headers.find(
            (header) => header.toLowerCase() === field.toLowerCase(),
          ) ?? "",
        ]),
      ),
    );
  }
  async function send(action: "PREVIEW" | "COMMIT") {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          kind,
          csv,
          mapping,
          sourceName: fileName,
          expectedHash: action === "COMMIT" ? preview?.hash : undefined,
        }),
      });
      const result = (await response.json()) as {
        data?: Preview & Summary;
        error?: { message: string };
      };
      if (!response.ok) {
        setError(result.error?.message ?? "La importación no pudo procesarse.");
        return;
      }
      if (action === "PREVIEW") setPreview(result.data ?? null);
      else setSummary(result.data ?? null);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="detail-layout">
      <div className="detail-main-column">
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">01 · Archivo</p>
              <h2>Datos de origen</h2>
            </div>
          </div>
          <div className="login-form">
            <label className="field-label">
              Tipo de importación
              <select
                value={kind}
                onChange={(event) =>
                  selectKind(event.target.value as ImportKind)
                }
              >
                {kinds.map((item) => (
                  <option key={item} value={item}>
                    {labels[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Archivo CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={upload}
              />
            </label>
            {fileName ? (
              <p>
                {fileName} · {encoding} · {headers.length} columnas
              </p>
            ) : null}
          </div>
        </section>
        {headers.length ? (
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">02 · Mapeo</p>
                <h2>Relaciona columnas</h2>
              </div>
            </div>
            <div className="login-form">
              {importColumns[kind].map((field) => (
                <label className="field-label" key={field}>
                  {field}
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(event) => {
                      setMapping({ ...mapping, [field]: event.target.value });
                      setPreview(null);
                      setSummary(null);
                    }}
                  >
                    <option value="">Sin mapear</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="primary-button"
                type="button"
                disabled={loading}
                onClick={() => send("PREVIEW")}
              >
                {loading ? "Validando…" : "Validar sin modificar datos"}
              </button>
            </div>
          </section>
        ) : null}
        {preview ? (
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">03 · Dry-run</p>
                <h2>
                  {preview.total} filas · {preview.created} nuevas ·{" "}
                  {preview.updated} actualizaciones
                </h2>
              </div>
            </div>
            {preview.errors.length ? (
              <div role="alert">
                {preview.errors.map((item, index) => (
                  <p key={index}>
                    Fila {item.row}: {item.code} · {item.message}
                  </p>
                ))}
              </div>
            ) : (
              <p>
                Sin errores bloqueantes. La confirmación volverá a validar el
                archivo y los permisos.
              </p>
            )}
            {preview.warnings.length ? (
              <details>
                <summary>{preview.warnings.length} advertencias</summary>
                {preview.warnings.slice(0, 30).map((item, index) => (
                  <p key={index}>
                    Fila {item.row}: {item.message}
                  </p>
                ))}
              </details>
            ) : null}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Identidad</th>
                    <th>Acción prevista</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 20).map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.identity}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={
                loading || preview.errors.length > 0 || Boolean(summary)
              }
              onClick={() => send("COMMIT")}
            >
              {loading ? "Importando…" : "Confirmar importación"}
            </button>
          </section>
        ) : null}
        {summary ? (
          <section className="data-panel" role="status">
            <div className="panel-title-row">
              <div>
                <p className="overline">04 · Resultado</p>
                <h2>
                  {summary.failed
                    ? "Importación parcial"
                    : "Importación completada"}
                </h2>
              </div>
            </div>
            <p>
              Job {summary.jobId} · creados {summary.created} · actualizados{" "}
              {summary.updated} · fallidos {summary.failed}
            </p>
            {summary.failures.map((item, index) => (
              <p key={index}>
                Fila {item.row}: {item.message}
              </p>
            ))}
          </section>
        ) : null}
      </div>
      <aside className="detail-side-column">
        <section className="data-panel">
          <p className="overline">Criterio de reconciliación</p>
          <h2>Sin duplicados silenciosos</h2>
          <p>
            Ubicaciones y activos se identifican por código en la planta.
            Recambios por SKU y proveedores por código en la organización. No se
            elimina historial ni se ajusta stock en esta carga.
          </p>
          <p>
            Para recambios, crea antes las categorías. Para activos, crea
            ubicaciones y clases. Los parent codes pueden estar en el mismo CSV.
          </p>
        </section>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
