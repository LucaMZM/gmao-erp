import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { saveMroMaster } from "@/lib/server/operations/mro-master";

const id = z.string().min(1).max(100);
const code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,49}$/);
const currency = z.enum(["EUR", "USD", "GBP"]);
const status = z.enum(["ACTIVE", "INACTIVE"]);
const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CATEGORY"),
    code,
    name: z.string().trim().min(2).max(160),
    parentId: id.nullable().optional(),
  }),
  z.object({
    type: z.literal("PART"),
    id: id.optional(),
    sku: code,
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000),
    categoryId: id,
    unit: z.string().trim().min(1).max(20),
    manufacturer: z.string().trim().max(160).nullable().optional(),
    manufacturerRef: z.string().trim().max(160).nullable().optional(),
    standardCost: z.number().nonnegative().finite(),
    currency,
    status,
  }),
  z.object({
    type: z.literal("WAREHOUSE"),
    id: id.optional(),
    code,
    name: z.string().trim().min(2).max(160),
    status,
  }),
  z.object({
    type: z.literal("BIN"),
    id: id.optional(),
    warehouseId: id,
    zoneId: id.nullable().optional(),
    code,
    description: z.string().trim().max(500),
    status,
  }),
  z.object({
    type: z.literal("VENDOR"),
    id: id.optional(),
    code,
    name: z.string().trim().min(2).max(160),
    category: z.string().trim().min(2).max(80),
    contactName: z.string().trim().max(160).nullable().optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    phone: z.string().trim().max(60).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    paymentTerms: z.string().trim().min(2).max(60),
    currency,
    leadTimeDays: z.number().int().min(0).max(365),
    status,
  }),
  z.object({
    type: z.literal("POLICY"),
    partId: id,
    primaryVendorId: id.nullable().optional(),
    critical: z.boolean(),
    minStock: z.number().nonnegative().finite(),
    maxStock: z.number().nonnegative().finite(),
    reorderPoint: z.number().nonnegative().finite(),
    leadTimeDays: z.number().int().min(0).max(365),
  }),
  z.object({
    type: z.literal("OFFER"),
    partId: id,
    vendorId: id,
    vendorSku: z.string().trim().min(1).max(100),
    manufacturer: z.string().trim().max(160).nullable().optional(),
    unitPrice: z.number().nonnegative().finite(),
    currency,
    minimumOrderQuantity: z.number().positive().finite(),
    leadTimeDays: z.number().int().min(0).max(365),
    preferred: z.boolean(),
    validUntil: z.string().datetime().nullable().optional(),
  }),
  z.object({
    type: z.literal("SUBSTITUTE"),
    partId: id,
    substitutePartId: id,
    note: z.string().trim().max(500).nullable().optional(),
    approvalStatus: z.enum(["APPROVED", "PENDING", "REJECTED"]),
  }),
]);

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
            message: "Revisa los datos MRO.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const data = await saveMroMaster(session, requestId, parsed.data);
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "MRO_MASTER_FAILED",
        message: "No se pudieron guardar los datos MRO.",
      },
      requestId,
    );
  }
}
