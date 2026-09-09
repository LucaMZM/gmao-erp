import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  assignTechnician,
  cancelWorkOrder,
  changeWorkOrderPriority,
  closeWorkOrder,
  completeWorkOrder,
  markWaiting,
  pauseWork,
  scheduleWorkOrder,
  startWork,
  stopLaborSession,
} from "@/lib/server/operations/work-orders";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ASSIGN"),
    technicianId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("SCHEDULE"),
    plannedStart: z.string().datetime(),
    plannedEnd: z.string().datetime(),
  }),
  z.object({
    action: z.enum(["START", "RESUME"]),
    technicianId: z.string().min(1).max(100).optional(),
  }),
  z.object({
    action: z.literal("PAUSE"),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.enum(["WAIT_PART", "WAIT_VENDOR"]),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("STOP_SESSION"),
    laborSessionId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("COMPLETE"),
    diagnosis: z.string().trim().max(2_000),
    solution: z.string().trim().min(5).max(2_000),
    failureMode: z.string().trim().max(80).nullable().optional(),
    failureCause: z.string().trim().max(80).nullable().optional(),
  }),
  z.object({ action: z.literal("CLOSE") }),
  z.object({
    action: z.literal("CANCEL"),
    reason: z.string().trim().min(5).max(1_000),
  }),
  z.object({
    action: z.literal("CHANGE_PRIORITY"),
    priority: z.enum([
      "P1_EMERGENCY",
      "P2_URGENT",
      "P3_HIGH",
      "P4_NORMAL",
      "P5_LOW",
    ]),
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
            message: "La acción o sus datos no son válidos.",
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
    let data: { ok: true; laborSessionId?: string } = { ok: true };
    switch (input.action) {
      case "ASSIGN":
        await assignTechnician(context, workOrderNumber, input.technicianId);
        break;
      case "SCHEDULE":
        await scheduleWorkOrder(context, workOrderNumber, input);
        break;
      case "START":
      case "RESUME":
        data = {
          ...(await startWork(context, workOrderNumber, input.technicianId)),
          ok: true,
        };
        break;
      case "PAUSE":
        await pauseWork(context, workOrderNumber, input.note);
        break;
      case "WAIT_PART":
      case "WAIT_VENDOR":
        await markWaiting(
          context,
          workOrderNumber,
          input.action === "WAIT_PART" ? "PART" : "VENDOR",
          input.note,
        );
        break;
      case "STOP_SESSION":
        await stopLaborSession(context, workOrderNumber, input.laborSessionId);
        break;
      case "COMPLETE":
        await completeWorkOrder(context, workOrderNumber, input);
        break;
      case "CLOSE":
        await closeWorkOrder(context, workOrderNumber);
        break;
      case "CANCEL":
        await cancelWorkOrder(context, workOrderNumber, input.reason);
        break;
      case "CHANGE_PRIORITY":
        await changeWorkOrderPriority(context, workOrderNumber, input.priority);
        break;
    }
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "WORK_ORDER_ACTION_FAILED",
        message: "No se ha podido aplicar la acción a la orden.",
      },
      requestId,
    );
  }
}
