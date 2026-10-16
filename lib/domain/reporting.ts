export type CostByAssetExportRow = {
  code: string;
  name: string;
  laborCents: number;
  materialCents: number;
  explicitCents: number;
  totalCents: number;
  downtimeMinutes: number;
};

export function reportingCsvRows(
  items: readonly CostByAssetExportRow[],
  includeHeader = true,
): string {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    // Quoting alone does not stop spreadsheet formula evaluation.
    const safe =
      /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = includeHeader
    ? [
        [
          "Activo",
          "Nombre",
          "Mano de obra EUR",
          "MRO EUR",
          "Otros EUR",
          "Total EUR",
          "Downtime min",
        ],
      ]
    : ([] as string[][]);
  for (const item of items) {
    rows.push([
      item.code,
      item.name,
      (item.laborCents / 100).toFixed(2),
      (item.materialCents / 100).toFixed(2),
      (item.explicitCents / 100).toFixed(2),
      (item.totalCents / 100).toFixed(2),
      String(item.downtimeMinutes),
    ]);
  }
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function reportingCsv(data: {
  costsByAsset: readonly CostByAssetExportRow[];
}): string {
  return reportingCsvRows(data.costsByAsset);
}
