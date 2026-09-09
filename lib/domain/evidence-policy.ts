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
