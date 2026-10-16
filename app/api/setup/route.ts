import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { bootstrapProduction } from "@/lib/server/production-bootstrap";

const schema = z.object({
  organizationCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/),
  organizationName: z.string().trim().min(3).max(160),
  siteCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/),
  siteName: z.string().trim().min(3).max(160),
  siteShortName: z.string().trim().min(2).max(48),
  city: z.string().trim().min(2).max(100),
  adminEmail: z.string().trim().email().max(160),
  adminName: z.string().trim().min(3).max(160),
  adminPassword: z
    .string()
    .min(14)
    .max(128)
    .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa los datos de aprovisionamiento.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    await bootstrapProduction(parsed.data, token, env.MAZMI_BOOTSTRAP_TOKEN);
    return NextResponse.json(
      { data: { status: "READY" }, requestId },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SETUP_FAILED",
        message: "No se ha podido aprovisionar el entorno.",
      },
      requestId,
    );
  }
}
