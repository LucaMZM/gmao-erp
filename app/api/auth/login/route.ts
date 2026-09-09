import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, createDemoSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const payload = loginSchema.safeParse(await readJsonBody(request));
    if (!payload.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa el email y la contraseña.",
            fields: payload.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }

    const session = await createDemoSession(
      payload.data.email,
      payload.data.password,
      requestId,
    );
    if (!session) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Las credenciales no son correctas.",
            requestId,
          },
        },
        { status: 401 },
      );
    }

    return NextResponse.json({
      data: {
        user: { fullName: session.fullName, role: session.roleName },
        redirectTo: session.roleKey === "TECHNICIAN" ? "/my-work" : "/overview",
      },
      requestId,
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "AUTH_UNAVAILABLE",
        message: "No se ha podido iniciar sesión. Inténtalo de nuevo.",
      },
      requestId,
    );
  }
}
