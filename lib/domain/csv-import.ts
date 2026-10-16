export type CsvTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
};

/** Bounded RFC-4180-style parser shared by preview and import confirmation. */
export function parseCsv(input: string): CsvTable {
  if (input.length > 2_000_000) throw new Error("CSV_TOO_LARGE");
  const source = input.replace(/^\uFEFF/, "");
  if (source.includes("\0")) throw new Error("CSV_BINARY_CONTENT");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0];
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (!quoted && field.trim() !== "")
        throw new Error("CSV_INVALID_QUOTE");
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(field.trim());
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      if (rows.length > 5001) throw new Error("CSV_TOO_MANY_ROWS");
    } else field += character;
    if (field.length > 10_000) throw new Error("CSV_CELL_TOO_LARGE");
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  const headers = rows.shift() ?? [];
  if (!headers.length || headers.length > 80)
    throw new Error("CSV_INVALID_HEADERS");
  if (
    new Set(headers.map((header) => header.toLowerCase())).size !==
    headers.length
  )
    throw new Error("CSV_DUPLICATE_HEADERS");
  if (rows.some((entry) => entry.length !== headers.length))
    throw new Error("CSV_COLUMN_MISMATCH");
  return { headers, rows, delimiter };
}

export const importColumns = {
  LOCATIONS: ["code", "name", "type", "parentCode", "description"],
  ASSETS: [
    "code",
    "name",
    "description",
    "kind",
    "locationCode",
    "parentCode",
    "classCode",
    "criticality",
    "manufacturer",
    "model",
    "serialNumber",
  ],
  PARTS: [
    "sku",
    "name",
    "description",
    "categoryCode",
    "unit",
    "standardCost",
    "manufacturer",
    "manufacturerRef",
  ],
  SUPPLIERS: ["code", "name", "category", "email", "phone", "leadTimeDays"],
} as const;
export type ImportKind = keyof typeof importColumns;
export type ColumnMapping = Record<string, string>;

export function mapCsvRows(
  table: CsvTable,
  mapping: ColumnMapping,
): Record<string, string>[] {
  for (const column of Object.values(mapping))
    if (column && !table.headers.includes(column))
      throw new Error("CSV_MAPPING_UNKNOWN_COLUMN");
  return table.rows.map((values) =>
    Object.fromEntries(
      Object.entries(mapping).map(([field, header]) => [
        field,
        header ? (values[table.headers.indexOf(header)] ?? "") : "",
      ]),
    ),
  );
}
