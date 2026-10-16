import { describe, expect, it } from "vitest";
import { parseCsv, mapCsvRows } from "@/lib/domain/csv-import";

describe("CSV import parser", () => {
  it("handles BOM, semicolons, quoted lines and escaped quotes", () => {
    const parsed = parseCsv(
      '\uFEFFcode;name;note\r\nA-01;"Equipo; principal";"Línea ""A"""\r\n',
    );
    expect(parsed.headers).toEqual(["code", "name", "note"]);
    expect(
      mapCsvRows(parsed, { code: "code", name: "name", description: "note" }),
    ).toEqual([
      { code: "A-01", name: "Equipo; principal", description: 'Línea "A"' },
    ]);
  });
  it("rejects malformed and oversized rows without mutation", () => {
    expect(() => parseCsv("code,code\na,b")).toThrow("CSV_DUPLICATE_HEADERS");
    expect(() => parseCsv('code,name\na,"unterminated')).toThrow(
      "CSV_UNCLOSED_QUOTE",
    );
    expect(() => parseCsv("a,b\n1")).toThrow("CSV_COLUMN_MISMATCH");
  });
});
