import { getD1 } from "@/db";
import { assertEnterprisePermission } from "@/lib/domain/governance";
import { ensureDatabase } from "../database";
import { ApiContractError } from "../http";
import {
  atomicBatch,
  assertMutationApplied,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

export async function addLaborRate(
  context: OperationContext,
  input: {
    userId: string;
    hourlyRateCents: number;
    effectiveFrom: string;
  },
): Promise<{ id: string }> {
  assertEnterprisePermission(
    context.session.permissionCodes,
    "identity.manage",
  );
  if (
    !Number.isSafeInteger(input.hourlyRateCents) ||
    input.hourlyRateCents < 0 ||
    input.hourlyRateCents > 1_000_000 ||
    !Number.isFinite(Date.parse(input.effectiveFrom))
  )
    throw new ApiContractError(
      422,
      "INVALID_LABOR_RATE",
      "Tarifa o fecha de vigencia no válida.",
    );
  await ensureDatabase();
  const db = getD1();
  const user = await db
    .prepare(
      `SELECT user.id FROM users user
     INNER JOIN memberships membership ON membership.user_id=user.id
     WHERE user.id=? AND membership.organization_id=? AND membership.status='ACTIVE' AND user.status='ACTIVE' LIMIT 1`,
    )
    .bind(input.userId, context.session.organizationId)
    .first();
  if (!user)
    throw new ApiContractError(
      422,
      "INVALID_RATE_USER",
      "El técnico no pertenece a la organización.",
    );
  const id = operationId("rate");
  const now = operationNow(context);
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `INSERT INTO labor_rate_cards
        (id,organization_id,user_id,role_key,shift_id,hourly_rate_cents,currency,effective_from,effective_to,created_at)
       SELECT ?,?,?,NULL,NULL,?,'EUR',?,NULL,?
       WHERE NOT EXISTS (SELECT 1 FROM labor_rate_cards WHERE organization_id=? AND user_id=? AND effective_from=?)`,
        )
        .bind(
          id,
          context.session.organizationId,
          input.userId,
          input.hourlyRateCents,
          input.effectiveFrom,
          now,
          context.session.organizationId,
          input.userId,
          input.effectiveFrom,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
        (id,organization_id,site_id,actor_id,action,entity_type,entity_id,previous_value,new_value,request_id,created_at)
       SELECT ?,?,?,?,'LABOR_RATE_CREATED','LABOR_RATE',?,NULL,?,?,? FROM labor_rate_cards WHERE id=?`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          id,
          JSON.stringify({
            userId: input.userId,
            hourlyRateCents: input.hourlyRateCents,
            effectiveFrom: input.effectiveFrom,
          }),
          context.requestId,
          now,
          id,
        ),
    ],
    [0, 1],
  );
  for (const result of results) assertMutationApplied(result);
  return { id };
}
