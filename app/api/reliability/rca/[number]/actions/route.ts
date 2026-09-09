import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  addRcaEvidence,
  changeRcaStatus,
  completeRcaAction,
  createRcaAction,
  saveRcaInvestigation,
} from "@/lib/server/operations/reliability";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_INVESTIGATION"),
    immediateCause: z.string().trim().max(2_000),
    rootCause: z.string().trim().max(2_000),
    whys: z
      .array(
        z.object({
          question: z.string().trim().min(3).max(500),
          answer: z.string().trim().min(3).max(1_000),
        }),
      )
      .max(5),
    version: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("CREATE_ACTION"),
    title: z.string().trim().min(5).max(180),
    description: z.string().trim().min(5).max(2_000),
    actionType: z.enum([
      "CREATE_WORK_ORDER",
      "UPDATE_MAINTENANCE_PLAN",
      "INSPECTION",
      "TRAINING",
      "TECHNICAL_CHANGE",
    ]),
    ownerId: z.string().min(1).max(100),
    targetAt: z.string().datetime().nullable().optional(),
    maintenancePlanId: z.string().min(1).max(100).nullable().optional(),
    version: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("ADD_EVIDENCE"),
    kind: z.enum([
      "OBSERVATION",
      "MEASUREMENT",
      "DOCUMENT",
      "PHOTO",
      "WORK_ORDER",
    ]),
    description: z.string().trim().min(5).max(2_000),
    sourceReference: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("CHANGE_STATUS"),
    status: z.enum([
      "INVESTIGATING",
      "ACTIONS_DEFINED",
      "VERIFICATION",
      "CLOSED",
      "CANCELLED",
    ]),
    version: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("COMPLETE_ACTION"),
    actionId: z.string().min(1).max(100),
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
            message: "Revisa los datos de la investigación.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const { number } = await params;
    const rcaNumber = decodeURIComponent(number);
    const context = { session, requestId };
    let data: {
      ok: true;
      actionId?: string;
      workOrderNumber?: string;
    } = { ok: true };
    const input = parsed.data;
    switch (input.action) {
      case "SAVE_INVESTIGATION":
        await saveRcaInvestigation(context, rcaNumber, input);
        break;
      case "CREATE_ACTION": {
        const result = await createRcaAction(context, rcaNumber, input);
        data = { ok: true, ...result };
        break;
      }
      case "ADD_EVIDENCE":
        await addRcaEvidence(context, rcaNumber, input);
        break;
      case "CHANGE_STATUS":
        await changeRcaStatus(context, rcaNumber, input);
        break;
      case "COMPLETE_ACTION":
        await completeRcaAction(context, rcaNumber, input);
        break;
    }
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "RCA_ACTION_FAILED",
        message: "No se ha podido actualizar la investigación.",
      },
      requestId,
    );
  }
}
