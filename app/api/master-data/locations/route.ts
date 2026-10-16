import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  createLocation,
  updateLocation,
} from "@/lib/server/operations/master-data";

export const locationSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
  name: z.string().trim().min(2).max(160),
  type: z.enum([
    "AREA",
    "PRODUCTION_LINE",
    "SYSTEM",
    "ZONE",
    "WAREHOUSE",
    "WORKSHOP",
    "LAB",
    "UTILITY",
  ]),
  parentId: z.string().min(1).max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = locationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa la ubicación.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const data = parsed.data.id
      ? await updateLocation(session, requestId, parsed.data.id, parsed.data)
      : await createLocation(session, requestId, parsed.data);
    return NextResponse.json(
      { data, requestId },
      { status: parsed.data.id ? 200 : 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "LOCATION_SAVE_FAILED",
        message: "No se pudo guardar la ubicación.",
      },
      requestId,
    );
  }
}
