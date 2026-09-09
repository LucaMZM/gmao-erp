import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { receivePurchaseOrder } from "@/lib/server/operations/procurement";

const schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
  externalReference: z.string().trim().max(160).nullable().optional(),
  receivedAt: z.string().datetime().nullable().optional(),
  version: z.number().int().positive(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1).max(100),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(100),
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
            message: "Revisa cantidades y referencia de recepción.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const data = await receivePurchaseOrder(
      { session, requestId },
      decodeURIComponent(number),
      parsed.data,
    );
    return NextResponse.json(
      { data, requestId },
      { status: data.created ? 201 : 200 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "GOODS_RECEIPT_FAILED",
        message: "No se ha podido registrar la recepción.",
      },
      requestId,
    );
  }
}
