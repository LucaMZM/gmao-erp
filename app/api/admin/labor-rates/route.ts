import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { addLaborRate } from "@/lib/server/operations/labor-rates";

const schema = z.object({
  userId: z.string().min(1).max(100),
  hourlyRateCents: z.number().int().nonnegative().max(1_000_000),
  effectiveFrom: z.string().datetime(),
});
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const input = schema.parse(await readJsonBody(request));
    const data = await addLaborRate({ session, requestId }, input);
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "LABOR_RATE_FAILED",
        message: "No se ha podido registrar la tarifa.",
      },
      requestId,
    );
  }
}
