import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createStockTransfer } from "@/lib/server/operations/procurement";

const schema = z.object({
  partId: z.string().min(1).max(100),
  fromBinId: z.string().min(1).max(100),
  toBinId: z.string().min(1).max(100),
  quantity: z.number().positive().max(1_000_000),
  note: z.string().trim().max(1_000).nullable().optional(),
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
            message: "Revisa pieza, origen, destino y cantidad.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const data = await createStockTransfer({ session, requestId }, parsed.data);
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "STOCK_TRANSFER_CREATE_FAILED",
        message: "No se ha podido crear la transferencia.",
      },
      requestId,
    );
  }
}
