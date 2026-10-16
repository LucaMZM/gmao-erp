import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createAssetClass } from "@/lib/server/operations/master-data";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
  name: z.string().trim().min(2).max(160),
  family: z.string().trim().min(2).max(100),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertSameOrigin();
    const session = await requireApiSession();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Revisa la clase de activo.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const data = await createAssetClass(session, requestId, parsed.data);
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "ASSET_CLASS_SAVE_FAILED",
        message: "No se pudo guardar la clase.",
      },
      requestId,
    );
  }
}
