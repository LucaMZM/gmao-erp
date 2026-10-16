import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { recordWorkOrderCost } from "@/lib/server/operations/work-order-costs";

const schema = z.object({
  kind: z.enum(["EXTERNAL_VENDOR", "OTHER"]),
  description: z.string().trim().min(5).max(500),
  amountCents: z.number().int().positive().max(100_000_000),
  vendorId: z.string().min(1).max(100).nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const input = schema.parse(await readJsonBody(request));
    const { number } = await params;
    const data = await recordWorkOrderCost(
      { session, requestId },
      decodeURIComponent(number),
      input,
    );
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "WORK_ORDER_COST_FAILED",
        message: "No se ha podido registrar el coste.",
      },
      requestId,
    );
  }
}
