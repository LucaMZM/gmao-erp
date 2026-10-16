import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { commitImport, previewImport } from "@/lib/server/operations/imports";

const schema = z.object({
  action: z.enum(["PREVIEW", "COMMIT"]),
  kind: z.enum(["LOCATIONS", "ASSETS", "PARTS", "SUPPLIERS"]),
  csv: z.string().min(1).max(2_000_000),
  sourceName: z.string().trim().min(1).max(200),
  mapping: z.record(z.string().max(100)),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa el archivo y el mapeo.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const { action, expectedHash, ...input } = parsed.data;
    if (action === "COMMIT" && !expectedHash)
      return NextResponse.json(
        {
          error: {
            code: "IMPORT_PREVIEW_REQUIRED",
            message: "Valida el archivo antes de confirmar.",
            requestId,
          },
        },
        { status: 400 },
      );
    const data =
      action === "PREVIEW"
        ? await previewImport(session, input)
        : await commitImport(session, requestId, input, expectedHash!);
    return NextResponse.json(
      { data, requestId },
      { status: action === "PREVIEW" ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      { code: "IMPORT_FAILED", message: "No se pudo procesar la importación." },
      requestId,
    );
  }
}
