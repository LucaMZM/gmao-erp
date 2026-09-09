import { NextResponse } from "next/server";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse } from "@/lib/server/http";
import { acknowledgeWorkOrderSafety } from "@/lib/server/operations/field";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const { number } = await params;
    await acknowledgeWorkOrderSafety(
      { session, requestId },
      decodeURIComponent(number),
    );
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SAFETY_ACKNOWLEDGEMENT_FAILED",
        message: "No se ha podido confirmar el contexto de seguridad.",
      },
      requestId,
    );
  }
}
