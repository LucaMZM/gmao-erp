import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiSession } from "@/lib/server/auth";
import { apiErrorResponse, readJsonBody } from "@/lib/server/http";
import {
  createManagedUser,
  updateManagedUser,
} from "@/lib/server/operations/identity-admin";

const scope = z.object({
  fullAreaAccess: z.boolean(),
  areaIds: z.array(z.string().min(1).max(100)).max(100),
  fullWarehouseAccess: z.boolean(),
  warehouseIds: z.array(z.string().min(1).max(100)).max(100),
});
const schema = z.discriminatedUnion("action", [
  scope.extend({
    action: z.literal("CREATE"),
    email: z.string().trim().email().max(160),
    fullName: z.string().trim().min(3).max(160),
    jobTitle: z.string().trim().min(2).max(160),
    roleKey: z.string().min(2).max(50),
    password: z
      .string()
      .min(14)
      .max(128)
      .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/),
  }),
  scope.extend({
    action: z.literal("UPDATE"),
    userId: z.string().min(1).max(100),
    roleKey: z.string().min(2).max(50),
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
]);

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
            message: "Revisa usuario y ámbitos.",
            fields: parsed.error.flatten().fieldErrors,
            requestId,
          },
        },
        { status: 400 },
      );
    const data =
      parsed.data.action === "CREATE"
        ? await createManagedUser(session, requestId, parsed.data)
        : await updateManagedUser(
            session,
            requestId,
            parsed.data.userId,
            parsed.data,
          );
    return NextResponse.json(
      { data, requestId },
      { status: parsed.data.action === "CREATE" ? 201 : 200 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "USER_ADMIN_FAILED",
        message: "No se pudo guardar el acceso del usuario.",
      },
      requestId,
    );
  }
}
