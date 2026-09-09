import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { changeRequisitionStatus } from "@/lib/server/operations/procurement";

const schema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT", "CANCEL"]),
  reason: z.string().trim().max(1_000).nullable().optional(),
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
            message: "Acción de requisición no válida.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    await changeRequisitionStatus(
      { session, requestId },
      decodeURIComponent(number),
      parsed.data,
    );
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "REQUISITION_ACTION_FAILED",
        message: "No se ha podido actualizar la requisición.",
      },
      requestId,
    );
  }
}
