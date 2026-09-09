import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createPurchaseRequisition } from "@/lib/server/operations/procurement";

const schema = z.object({
  partId: z.string().min(1).max(100),
  quantity: z.number().positive().max(1_000_000),
  warehouseId: z.string().min(1).max(100).nullable().optional(),
  workOrderNumber: z.string().min(1).max(80).nullable().optional(),
  origin: z.enum(["WORK_ORDER", "LOW_STOCK", "STOCKOUT", "MANUAL", "PLANNING"]),
  urgency: z.enum(["ROUTINE", "HIGH", "CRITICAL"]),
  needBy: z.string().datetime().nullable().optional(),
  justification: z.string().trim().min(5).max(1_500),
  submit: z.boolean().optional(),
});

export async function POST(request: Request) {
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
            message: "Revisa la necesidad, cantidad y justificación.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const data = await createPurchaseRequisition(
      { session, requestId },
      parsed.data,
    );
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "PURCHASE_REQUISITION_CREATE_FAILED",
        message: "No se ha podido crear la requisición.",
      },
      requestId,
    );
  }
}
