import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  generatePreventiveWorkOrder,
  setMaintenancePlanStatus,
} from "@/lib/server/operations/preventive";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("GENERATE") }),
  z.object({
    action: z.literal("SET_STATUS"),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    expectedVersion: z.number().int().positive(),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
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
            message: "La acción preventiva no es válida.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const code = decodeURIComponent((await params).code);
    let data: unknown = { ok: true };
    if (parsed.data.action === "GENERATE") {
      data = await generatePreventiveWorkOrder({ session, requestId }, code);
    } else {
      await setMaintenancePlanStatus(
        { session, requestId },
        code,
        parsed.data.status,
        parsed.data.expectedVersion,
      );
    }
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "MAINTENANCE_PLAN_ACTION_FAILED",
        message: "No se ha podido aplicar la acción preventiva.",
      },
      requestId,
    );
  }
}
