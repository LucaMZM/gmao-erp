import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createAsset, updateAsset } from "@/lib/server/operations/master-data";

export const assetSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000),
  kind: z.enum(["EQUIPMENT", "ASSEMBLY", "COMPONENT"]),
  functionalLocationId: z.string().min(1).max(100),
  parentAssetId: z.string().min(1).max(100).nullable().optional(),
  assetClassId: z.string().min(1).max(100),
  vendorId: z.string().min(1).max(100).nullable().optional(),
  status: z.enum([
    "OPERATING",
    "DEGRADED",
    "DOWN",
    "MAINTENANCE",
    "STANDBY",
    "RETIRED",
  ]),
  criticality: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  manufacturer: z.string().trim().max(160).nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  serialNumber: z.string().trim().max(160).nullable().optional(),
  commissionedAt: z.string().datetime().nullable().optional(),
  warrantyUntil: z.string().datetime().nullable().optional(),
  technicalSummary: z.string().trim().max(4000).nullable().optional(),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = assetSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa el activo.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const data = parsed.data.id
      ? await updateAsset(session, requestId, parsed.data.id, parsed.data)
      : await createAsset(session, requestId, parsed.data);
    return NextResponse.json(
      { data, requestId },
      { status: parsed.data.id ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      { code: "ASSET_SAVE_FAILED", message: "No se pudo guardar el activo." },
      requestId,
    );
  }
}
