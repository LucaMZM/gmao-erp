import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  addPlannedMaterial,
  consumeMaterial,
  releaseMaterial,
  reserveMaterial,
  returnMaterial,
} from "@/lib/server/operations/materials";

const quantity = z.number().positive().max(100_000);
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ADD_PLANNED"),
    partId: z.string().min(1).max(100),
    quantity,
  }),
  z.object({
    action: z.enum(["RESERVE", "RELEASE", "CONSUME", "RETURN"]),
    materialId: z.string().min(1).max(100),
    quantity,
  }),
]);

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
            message: "La operación de material no es válida.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const workOrderNumber = decodeURIComponent(number);
    const context = { session, requestId };
    const input = parsed.data;
    let data: { materialId?: string; ok: true } = { ok: true };
    if (input.action === "ADD_PLANNED") {
      data = {
        ...(await addPlannedMaterial(
          context,
          workOrderNumber,
          input.partId,
          input.quantity,
        )),
        ok: true,
      };
    } else if (input.action === "RESERVE") {
      await reserveMaterial(
        context,
        workOrderNumber,
        input.materialId,
        input.quantity,
      );
    } else if (input.action === "RELEASE") {
      await releaseMaterial(
        context,
        workOrderNumber,
        input.materialId,
        input.quantity,
      );
    } else if (input.action === "CONSUME") {
      await consumeMaterial(
        context,
        workOrderNumber,
        input.materialId,
        input.quantity,
      );
    } else {
      await returnMaterial(
        context,
        workOrderNumber,
        input.materialId,
        input.quantity,
      );
    }
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "MATERIAL_OPERATION_FAILED",
        message: "No se ha podido registrar la operación de material.",
      },
      requestId,
    );
  }
}
