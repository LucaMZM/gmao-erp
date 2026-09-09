import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, switchCurrentSite } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";

const schema = z.object({ siteId: z.string().min(1).max(80) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const payload = schema.safeParse(await readJsonBody(request));
    if (!payload.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Centro no válido.",
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const outcome = await switchCurrentSite(payload.data.siteId, requestId);
    if (outcome === "UNAUTHORIZED") {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Sesión requerida.",
            requestId,
          },
        },
        { status: 401 },
      );
    }
    if (outcome === "FORBIDDEN") {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "No tienes acceso a este centro.",
            requestId,
          },
        },
        { status: 403 },
      );
    }
    return NextResponse.json({
      data: { siteId: payload.data.siteId },
      requestId,
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SITE_SWITCH_FAILED",
        message: "No se ha podido cambiar de centro.",
      },
      requestId,
    );
  }
}
