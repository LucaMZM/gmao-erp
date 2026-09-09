import { NextResponse } from "next/server";
import { assertSameOrigin, destroyDemoSession } from "@/lib/server/auth";
import { apiErrorResponse } from "@/lib/server/http";

export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    await destroyDemoSession();
    return NextResponse.json({ data: { redirectTo: "/" }, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "LOGOUT_FAILED",
        message: "No se ha podido cerrar la sesión.",
      },
      requestId,
    );
  }
}
