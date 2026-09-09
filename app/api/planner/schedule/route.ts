import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { movePlannerWork } from "@/lib/server/operations/planner";

const schema = z.object({
  number: z.string().trim().min(5).max(80),
  expectedVersion: z.number().int().positive(),
  technicianId: z.string().min(1).max(100).nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
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
            message: "El destino de planificación no es válido.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const data = await movePlannerWork(
      { session, requestId },
      parsed.data.number,
      parsed.data,
    );
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "PLANNER_MOVE_FAILED",
        message: "No se ha podido persistir el cambio de planificación.",
      },
      requestId,
    );
  }
}
