import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { convertRequisitionToPurchaseOrder } from "@/lib/server/operations/procurement";

const schema = z.object({
  vendorId: z.string().min(1).max(100),
  offerId: z.string().min(1).max(100).nullable().optional(),
  warehouseId: z.string().min(1).max(100).nullable().optional(),
  destinationBinId: z.string().min(1).max(100).nullable().optional(),
  expectedAt: z.string().datetime().nullable().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  version: z.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Selecciona proveedor, destino y fecha válidos.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const data = await convertRequisitionToPurchaseOrder(
      { session, requestId },
      decodeURIComponent(number),
      parsed.data,
    );
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "REQUISITION_CONVERT_FAILED",
        message: "No se ha podido crear el pedido.",
      },
      requestId,
    );
  }
}
