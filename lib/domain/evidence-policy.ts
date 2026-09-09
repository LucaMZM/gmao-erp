import { DomainInvariantError } from "./errors";

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EVIDENCE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function sanitizeEvidenceFileName(fileName: string): string {
  const base = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return base || "evidencia";
}

export function assertEvidencePolicy(contentType: string, sizeBytes: number) {
  if (!(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(contentType)) {
    throw new DomainInvariantError(
      "EVIDENCE_TYPE_NOT_ALLOWED",
      "El tipo de archivo no está permitido.",
    );
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_EVIDENCE_BYTES) {
    throw new DomainInvariantError(
      "EVIDENCE_SIZE_NOT_ALLOWED",
      "La evidencia supera el límite de 10 MB.",
    );
  }
}

export function assertEvidenceContent(
  contentType: string,
  data: ArrayBuffer,
): void {
  const bytes = new Uint8Array(data);
  const matches =
    (contentType === "image/png" &&
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, index) => bytes[index] === byte,
      )) ||
    (contentType === "image/jpeg" &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (contentType === "image/webp" &&
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") ||
    (contentType === "application/pdf" &&
      bytes.length >= 5 &&
      String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-");
  if (!matches) {
    throw new DomainInvariantError(
      "EVIDENCE_CONTENT_MISMATCH",
      "El contenido del archivo no coincide con su tipo declarado.",
    );
  }
}
