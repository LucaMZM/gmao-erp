import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import { createMaintenancePlan } from "@/lib/server/operations/preventive";

const schema = z.object({
  assetId: z.string().min(1).max(100),
  ownerId: z.string().min(1).max(100),
  title: z.string().trim().min(5).max(180),
  description: z.string().trim().min(10).max(2_000),
  criticality: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  priority: z.enum([
    "P1_EMERGENCY",
    "P2_URGENT",
    "P3_HIGH",
    "P4_NORMAL",
    "P5_LOW",
  ]),
  estimatedMinutes: z.number().int().min(1).max(1_440),
  triggerMode: z.enum(["CALENDAR", "METER", "WHICHEVER_FIRST"]),
  calendarUnit: z.enum(["DAY", "WEEK", "MONTH"]).nullable().optional(),
  calendarInterval: z.number().int().min(1).max(365).nullable().optional(),
  firstDueAt: z.string().datetime().nullable().optional(),
  meterId: z.string().min(1).max(100).nullable().optional(),
  meterInterval: z.number().positive().nullable().optional(),
  meterThreshold: z.number().nonnegative().nullable().optional(),
  leadDays: z.number().int().min(0).max(90).default(7),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(1_000).nullable().optional(),
        required: z.boolean().optional(),
        responseType: z
          .enum([
            "CHECKBOX",
            "CONFIRMATION",
            "TEXT",
            "NUMBER",
            "READING",
            "PASS_FAIL",
          ])
          .optional(),
        unit: z.string().trim().max(30).nullable().optional(),
        minimumValue: z.number().finite().nullable().optional(),
        maximumValue: z.number().finite().nullable().optional(),
        meterId: z.string().min(1).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
  skills: z
    .array(
      z.object({
        skillId: z.string().min(1).max(100),
        minimumLevel: z.number().int().min(1).max(5),
      }),
    )
    .max(20),
  certificationIds: z.array(z.string().min(1).max(100)).max(20),
  materials: z
    .array(
      z.object({
        partId: z.string().min(1).max(100),
        quantity: z.number().positive(),
      }),
    )
    .max(50),
});

export async function POST(request: Request) {
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
            message: "Revisa los datos del plan preventivo.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    }
    const data = await createMaintenancePlan(
      { session, requestId },
      parsed.data,
    );
    return NextResponse.json({ data, requestId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "MAINTENANCE_PLAN_CREATE_FAILED",
        message: "No se ha podido crear el plan preventivo.",
      },
      requestId,
    );
  }
}
