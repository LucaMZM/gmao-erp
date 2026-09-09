import { env } from "cloudflare:workers";
import { ApiContractError } from "./http";

export type StoredEvidenceObject = {
  body: ReadableStream;
  contentType: string;
  size: number;
};

export interface EvidenceStorage {
  put(
    key: string,
    data: ArrayBuffer,
    contentType: string,
  ): Promise<{ key: string; size: number }>;
  get(key: string): Promise<StoredEvidenceObject | null>;
  delete(key: string): Promise<void>;
}

class R2EvidenceStorage implements EvidenceStorage {
  async put(key: string, data: ArrayBuffer, contentType: string) {
    await env.FILES.put(key, data, { httpMetadata: { contentType } });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<StoredEvidenceObject | null> {
    const object = await env.FILES.get(key);
    if (!object) return null;
    return {
      body: object.body,
      contentType:
        object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
    };
  }

  async delete(key: string): Promise<void> {
    await env.FILES.delete(key);
  }
}

export function getEvidenceStorage(): EvidenceStorage {
  if (!env.FILES) {
    throw new ApiContractError(
      503,
      "EVIDENCE_STORAGE_UNAVAILABLE",
      "El almacenamiento de evidencias no está disponible.",
    );
  }
  return new R2EvidenceStorage();
}
