import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { getEvidenceStorage } from "@/lib/server/file-storage";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  createEvidenceMetadata,
  authorizeFieldReplay,
} from "@/lib/server/operations/field";
import { operationId } from "@/lib/server/operations/shared";
import { runIdempotent } from "@/lib/server/operations/shared";
import {
  assertEvidenceContent,
  assertEvidencePolicy,
  sanitizeEvidenceFileName,
} from "@/lib/domain/evidence-policy";

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("NOTE"),
    stage: z.enum(["BEFORE", "DURING", "AFTER", "GENERAL"]),
    description: z.string().trim().min(2).max(2_000),
  }),
  z.object({
    kind: z.enum(["PHOTO", "DOCUMENT"]),
    stage: z.enum(["BEFORE", "DURING", "AFTER", "GENERAL"]),
    description: z.string().trim().min(2).max(500),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.string().trim().min(3).max(120),
    dataBase64: z.string().min(4).max(11_000_000),
  }),
]);

function decodeBase64(value: string): ArrayBuffer {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const decoded = atob(raw);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const requestId = crypto.randomUUID();
  let storedKey: string | null = null;
  let metadataCommitted = false;
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "La evidencia no es válida.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const evidenceId = operationId("evidence");
    const input = parsed.data;
    const context = { session, requestId };
    await authorizeFieldReplay(
      context,
      decodeURIComponent(number),
      "FIELD_EVIDENCE",
    );
    const { value, replayed } = await runIdempotent(
      context,
      request.headers.get("idempotency-key"),
      "FIELD_EVIDENCE",
      async () => {
        let fileMetadata: {
          storageKey: string;
          fileName: string;
          contentType: string;
          sizeBytes: number;
          checksumSha256: string;
        } | null = null;
        if (input.kind !== "NOTE") {
          const data = decodeBase64(input.dataBase64);
          assertEvidencePolicy(input.contentType, data.byteLength);
          assertEvidenceContent(input.contentType, data);
          const checksum = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
          )
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          const safeFileName = sanitizeEvidenceFileName(input.fileName);
          storedKey = `${session.organizationId}/${session.siteId}/${evidenceId}/${safeFileName}`;
          const stored = await getEvidenceStorage().put(
            storedKey,
            data,
            input.contentType,
          );
          fileMetadata = {
            storageKey: stored.key,
            fileName: safeFileName,
            contentType: input.contentType,
            sizeBytes: stored.size,
            checksumSha256: checksum,
          };
        }
        await createEvidenceMetadata(context, decodeURIComponent(number), {
          id: evidenceId,
          ...input,
          ...fileMetadata,
        });
        metadataCommitted = true;
        return { id: evidenceId, ok: true };
      },
      { number: decodeURIComponent(number), input },
    );
    return NextResponse.json(
      { data: value, replayed, requestId },
      { status: replayed ? 200 : 201 },
    );
  } catch (error) {
    if (storedKey && !metadataCommitted) {
      try {
        await getEvidenceStorage().delete(storedKey);
      } catch {
        // The metadata operation remains authoritative; orphan cleanup can retry later.
      }
    }
    return apiErrorResponse(
      error,
      {
        code: "EVIDENCE_FAILED",
        message: "No se ha podido guardar la evidencia.",
      },
      requestId,
    );
  }
}
