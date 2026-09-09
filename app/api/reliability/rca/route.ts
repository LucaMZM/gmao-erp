import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createRootCauseAnalysis } from "@/lib/server/operations/reliability";

const schema = z.object({
  assetId: z.string().min(1).max(100),
  sourceWorkOrderId: z.string().min(1).max(100).nullable().optional(),
  failureModeId: z.string().min(1).max(100).nullable().optional(),
  ownerId: z.string().min(1).max(100),
  problem: z.string().trim().min(10).max(2_000),
  impact: z.string().trim().min(5).max(2_000),
  targetAt: z.string().datetime().nullable().optional(),
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
            message: "Revisa el contexto y el problema de la investigación.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const data = await createRootCauseAnalysis(
      { session, requestId },
      parsed.data,
    );
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "RCA_CREATE_FAILED",
        message: "No se ha podido iniciar la investigación.",
      },
      requestId,
    );
  }
}
