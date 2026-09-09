import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { changePurchaseOrderStatus } from "@/lib/server/operations/procurement";

const schema = z.object({
  action: z.enum(["APPROVE", "SEND", "CANCEL"]),
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
            message: "Acción de pedido no válida.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    await changePurchaseOrderStatus(
      { session, requestId },
      decodeURIComponent(number),
      parsed.data,
    );
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "PURCHASE_ORDER_ACTION_FAILED",
        message: "No se ha podido actualizar el pedido.",
      },
      requestId,
    );
  }
}
