import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { recordPhysicalCount } from "@/lib/server/operations/physical-count";

const common = z.object({
  countedQuantity: z.number().finite().nonnegative(),
  reason: z.string().trim().min(8).max(500),
});
const schema = z.union([
  common.extend({
    stockId: z.string().min(1).max(100),
    expectedVersion: z.number().int().positive(),
  }),
  common.extend({
    partId: z.string().min(1).max(100),
    binId: z.string().min(1).max(100),
    expectedVersion: z.literal(0),
  }),
]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const input = schema.parse(await readJsonBody(request));
    const data = await recordPhysicalCount({ session, requestId }, input);
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "PHYSICAL_COUNT_FAILED",
        message: "No se ha podido registrar el conteo.",
      },
      requestId,
    );
  }
}
