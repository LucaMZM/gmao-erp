import { getD1 } from "@/db";
import { assertPermission } from "@/lib/domain/permissions";
import { assertValidRcaStatusTransition } from "@/lib/domain/reliability";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import {
  atomicBatch,
  assertMutationApplied,
  assertLocationScope,
  jsonValue,
  nextPlantNumber,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type RcaRow = {
  id: string;
  number: string;
  assetId: string;
  functionalLocationId: string;
  status: string;
  rootCause: string | null;
  version: number;
};

async function findRca(
  session: DemoUserSession,
  number: string,
): Promise<RcaRow> {
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      `SELECT rca.id, rca.number, rca.asset_id AS assetId,
        asset.functional_location_id AS functionalLocationId,
        rca.status, rca.root_cause AS rootCause, rca.version
       FROM root_cause_analyses rca
       INNER JOIN assets asset ON asset.id = rca.asset_id
       WHERE rca.number = ? AND rca.organization_id = ? AND rca.site_id = ? LIMIT 1`,
    )
    .bind(number, session.organizationId, session.siteId)
    .first<RcaRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "RCA_NOT_FOUND",
      "La investigación no existe en el centro activo.",
    );
  }
  await assertLocationScope(session, row.functionalLocationId);
  return row;
}

async function assertOwner(session: DemoUserSession, ownerId: string) {
  const owner = await getD1()
    .prepare(
      `SELECT user.id FROM users user
       INNER JOIN memberships membership ON membership.user_id = user.id
       WHERE user.id = ? AND membership.organization_id = ?
         AND membership.status = 'ACTIVE' AND user.status = 'ACTIVE' LIMIT 1`,
    )
    .bind(ownerId, session.organizationId)
    .first<{ id: string }>();
  if (!owner) {
    throw new ApiContractError(
      422,
      "INVALID_RCA_OWNER",
      "Selecciona un responsable válido de la organización.",
    );
  }
  return owner;
}

export type CreateRcaInput = {
  assetId: string;
  sourceWorkOrderId?: string | null;
  failureModeId?: string | null;
  ownerId: string;
  problem: string;
  impact: string;
  targetAt?: string | null;
};

export async function createRootCauseAnalysis(
  context: OperationContext,
  input: CreateRcaInput,
): Promise<{ number: string }> {
  assertPermission(context.session, "RCA_CREATE");
  await ensureDatabase();
  const now = operationNow(context);
  const db = getD1();
  const asset = await db
    .prepare(
      `SELECT id, functional_location_id AS functionalLocationId FROM assets WHERE id = ? AND organization_id = ? AND site_id = ?
       AND status <> 'RETIRED' LIMIT 1`,
    )
    .bind(input.assetId, context.session.organizationId, context.session.siteId)
    .first<{ id: string; functionalLocationId: string }>();
  if (!asset) {
    throw new ApiContractError(
      422,
      "INVALID_RCA_ASSET",
      "Selecciona un activo del centro actual.",
    );
  }
  await assertOwner(context.session, input.ownerId);
  await assertLocationScope(context.session, asset.functionalLocationId);
  if (input.sourceWorkOrderId) {
    const source = await db
      .prepare(
        "SELECT id FROM work_orders WHERE id = ? AND asset_id = ? AND organization_id = ? AND site_id = ? LIMIT 1",
      )
      .bind(
        input.sourceWorkOrderId,
        asset.id,
        context.session.organizationId,
        context.session.siteId,
      )
      .first<{ id: string }>();
    if (!source) {
      throw new ApiContractError(
        422,
        "INVALID_RCA_SOURCE",
        "La OT de origen debe pertenecer al activo y centro seleccionados.",
      );
    }
  }
  if (input.failureModeId) {
    const mode = await db
      .prepare(
        "SELECT id FROM failure_modes WHERE id = ? AND organization_id = ? AND status = 'ACTIVE' LIMIT 1",
      )
      .bind(input.failureModeId, context.session.organizationId)
      .first<{ id: string }>();
    if (!mode) {
      throw new ApiContractError(
        422,
        "INVALID_FAILURE_MODE",
        "Selecciona un modo de fallo válido.",
      );
    }
  }
  const id = operationId("rca");
  const number = await nextPlantNumber(context.session, "RCA", now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO root_cause_analyses
          (id, organization_id, site_id, number, asset_id, source_work_order_id,
           failure_mode_id, created_by_id, owner_id, problem, impact,
           immediate_cause, root_cause, status, target_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'DRAFT', ?, 1, ?, ?)`,
      )
      .bind(
        id,
        context.session.organizationId,
        context.session.siteId,
        number,
        asset.id,
        input.sourceWorkOrderId ?? null,
        input.failureModeId ?? null,
        context.session.userId,
        input.ownerId,
        input.problem.trim(),
        input.impact.trim(),
        input.targetAt ?? null,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO rca_events
          (id, root_cause_analysis_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'RCA_CREATED', NULL, 'DRAFT', ?, ?)`,
      )
      .bind(
        operationId("event"),
        id,
        context.session.userId,
        "Investigación iniciada desde el contexto operativo.",
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'RCA_CREATED', 'ROOT_CAUSE_ANALYSIS', ?, NULL, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        id,
        jsonValue({ number, status: "DRAFT", assetId: asset.id }),
        context.requestId,
        now,
      ),
  ]);
  return { number };
}

export type SaveInvestigationInput = {
  immediateCause: string;
  rootCause: string;
  whys: Array<{ question: string; answer: string }>;
  version: number;
};

export async function saveRcaInvestigation(
  context: OperationContext,
  number: string,
  input: SaveInvestigationInput,
): Promise<void> {
  assertPermission(context.session, "RCA_MANAGE");
  const rca = await findRca(context.session, number);
  if (["CLOSED", "CANCELLED"].includes(rca.status)) {
    throw new ApiContractError(
      409,
      "RCA_TERMINAL",
      "Una investigación cerrada o cancelada no puede modificarse.",
    );
  }
  if (input.version !== rca.version) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "La investigación ha cambiado en otra sesión. Actualiza y reintenta.",
    );
  }
  const now = operationNow(context);
  const nextStatus = rca.status === "DRAFT" ? "INVESTIGATING" : rca.status;
  if (nextStatus !== rca.status) {
    assertValidRcaStatusTransition(rca.status, nextStatus, 0, input.rootCause);
  }
  const db = getD1();
  const update = db
    .prepare(
      `UPDATE root_cause_analyses SET immediate_cause = ?, root_cause = ?,
        status = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(
      input.immediateCause.trim() || null,
      input.rootCause.trim() || null,
      nextStatus,
      now,
      rca.id,
      input.version,
    );
  const statements = [
    update,
    db
      .prepare("DELETE FROM rca_whys WHERE root_cause_analysis_id = ?")
      .bind(rca.id),
    ...input.whys
      .slice(0, 5)
      .map((item, index) =>
        db
          .prepare(
            "INSERT INTO rca_whys (id, root_cause_analysis_id, sequence, question, answer) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            operationId("why"),
            rca.id,
            index + 1,
            item.question.trim(),
            item.answer.trim(),
          ),
      ),
    db
      .prepare(
        `INSERT INTO rca_events
          (id, root_cause_analysis_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'INVESTIGATION_UPDATED', ?, ?, ?, ?)`,
      )
      .bind(
        operationId("event"),
        rca.id,
        context.session.userId,
        rca.status,
        nextStatus,
        "Causas y cadena de porqués actualizadas.",
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'RCA_INVESTIGATION_UPDATED', 'ROOT_CAUSE_ANALYSIS', ?, ?, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        rca.id,
        jsonValue({ status: rca.status, rootCause: rca.rootCause }),
        jsonValue({ status: nextStatus, rootCause: input.rootCause.trim() }),
        context.requestId,
        now,
      ),
  ];
  const results = await atomicBatch(db, statements, [0]);
  assertMutationApplied(results[0]);
}

export type CreateRcaActionInput = {
  title: string;
  description: string;
  actionType:
    | "CREATE_WORK_ORDER"
    | "UPDATE_MAINTENANCE_PLAN"
    | "INSPECTION"
    | "TRAINING"
    | "TECHNICAL_CHANGE";
  ownerId: string;
  targetAt?: string | null;
  maintenancePlanId?: string | null;
  version: number;
};

export async function createRcaAction(
  context: OperationContext,
  number: string,
  input: CreateRcaActionInput,
): Promise<{ actionId: string; workOrderNumber?: string }> {
  assertPermission(context.session, "RCA_MANAGE");
  const rca = await findRca(context.session, number);
  if (!["INVESTIGATING", "ACTIONS_DEFINED"].includes(rca.status)) {
    throw new ApiContractError(
      409,
      "RCA_ACTION_NOT_ALLOWED",
      "Define primero la causa y deja la RCA en investigación.",
    );
  }
  if (input.version !== rca.version) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "La investigación ha cambiado en otra sesión. Actualiza y reintenta.",
    );
  }
  if (!rca.rootCause?.trim()) {
    throw new ApiContractError(
      409,
      "RCA_ROOT_CAUSE_REQUIRED",
      "Define una causa raíz antes de crear acciones correctivas.",
    );
  }
  await assertOwner(context.session, input.ownerId);
  const db = getD1();
  if (input.actionType === "UPDATE_MAINTENANCE_PLAN") {
    if (!input.maintenancePlanId) {
      throw new ApiContractError(
        422,
        "RCA_PLAN_REQUIRED",
        "Selecciona el plan preventivo que debe revisarse.",
      );
    }
    const plan = await db
      .prepare(
        "SELECT id FROM maintenance_plans WHERE id = ? AND asset_id = ? AND organization_id = ? AND site_id = ? LIMIT 1",
      )
      .bind(
        input.maintenancePlanId,
        rca.assetId,
        context.session.organizationId,
        context.session.siteId,
      )
      .first<{ id: string }>();
    if (!plan) {
      throw new ApiContractError(
        422,
        "INVALID_RCA_PLAN",
        "El plan debe pertenecer al activo investigado.",
      );
    }
  }

  const now = operationNow(context);
  const actionId = operationId("rca-action");
  const createsWork = ["CREATE_WORK_ORDER", "INSPECTION"].includes(
    input.actionType,
  );
  const workOrderId = createsWork ? operationId("wo") : null;
  const workOrderNumber = createsWork
    ? await nextPlantNumber(context.session, "OT", now)
    : null;
  const statements = [];
  if (workOrderId && workOrderNumber) {
    statements.push(
      db
        .prepare(
          `INSERT INTO work_orders
            (id, organization_id, site_id, asset_id, functional_location_id,
             requested_by_id, number, title, description, status, priority, type,
             source, requested_at, due_at, estimated_minutes, downtime_minutes,
             production_impact, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'P3_HIGH', ?, 'SYSTEM',
             ?, ?, 120, 0, 'NONE', 1, ?, ?)`,
        )
        .bind(
          workOrderId,
          context.session.organizationId,
          context.session.siteId,
          rca.assetId,
          rca.functionalLocationId,
          context.session.userId,
          workOrderNumber,
          input.title.trim(),
          `${input.description.trim()} · Acción originada en ${rca.number}.`,
          input.actionType === "INSPECTION" ? "INSPECTION" : "IMPROVEMENT",
          now,
          input.targetAt ?? null,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO work_order_events
            (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
           VALUES (?, ?, ?, 'RCA_ACTION_WORK_ORDER_CREATED', NULL, 'APPROVED', ?, ?)`,
        )
        .bind(
          operationId("event"),
          workOrderId,
          context.session.userId,
          `Acción trazada desde ${rca.number}.`,
          now,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO rca_actions
          (id, root_cause_analysis_id, title, description, action_type, status,
           owner_id, target_at, linked_work_order_id, linked_maintenance_plan_id,
           completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        actionId,
        rca.id,
        input.title.trim(),
        input.description.trim(),
        input.actionType,
        input.ownerId,
        input.targetAt ?? null,
        workOrderId,
        input.maintenancePlanId ?? null,
        now,
        now,
      ),
    db
      .prepare(
        "UPDATE root_cause_analyses SET status = 'ACTIONS_DEFINED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .bind(now, rca.id, rca.version),
    db
      .prepare(
        `INSERT INTO rca_events
          (id, root_cause_analysis_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'RCA_ACTION_CREATED', ?, 'ACTIONS_DEFINED', ?, ?)`,
      )
      .bind(
        operationId("event"),
        rca.id,
        context.session.userId,
        rca.status,
        input.title.trim(),
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'RCA_ACTION_CREATED', 'ROOT_CAUSE_ANALYSIS', ?, ?, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        rca.id,
        jsonValue({ status: rca.status }),
        jsonValue({ status: "ACTIONS_DEFINED", actionId, workOrderNumber }),
        context.requestId,
        now,
      ),
  );
  const results = await atomicBatch(db, statements, [statements.length - 3]);
  const updateIndex = statements.length - 3;
  assertMutationApplied(results[updateIndex]);
  return workOrderNumber ? { actionId, workOrderNumber } : { actionId };
}

export async function addRcaEvidence(
  context: OperationContext,
  number: string,
  input: { kind: string; description: string; sourceReference?: string | null },
): Promise<void> {
  assertPermission(context.session, "RCA_MANAGE");
  const rca = await findRca(context.session, number);
  if (["CLOSED", "CANCELLED"].includes(rca.status)) {
    throw new ApiContractError(
      409,
      "RCA_TERMINAL",
      "La RCA ya no admite evidencias.",
    );
  }
  const now = operationNow(context);
  await getD1().batch([
    getD1()
      .prepare(
        "INSERT INTO rca_evidence (id, root_cause_analysis_id, kind, description, source_reference, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        operationId("evidence"),
        rca.id,
        input.kind,
        input.description.trim(),
        input.sourceReference?.trim() || null,
        context.session.userId,
        now,
      ),
    getD1()
      .prepare(
        "INSERT INTO rca_events (id, root_cause_analysis_id, actor_id, event_type, note, created_at) VALUES (?, ?, ?, 'EVIDENCE_ADDED', ?, ?)",
      )
      .bind(
        operationId("event"),
        rca.id,
        context.session.userId,
        input.description.trim(),
        now,
      ),
  ]);
}

export async function changeRcaStatus(
  context: OperationContext,
  number: string,
  input: { status: string; version: number },
): Promise<void> {
  assertPermission(context.session, "RCA_MANAGE");
  const rca = await findRca(context.session, number);
  if (input.version !== rca.version) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "La investigación ha cambiado en otra sesión. Actualiza y reintenta.",
    );
  }
  const row = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM rca_actions WHERE root_cause_analysis_id = ? AND status IN ('OPEN','IN_PROGRESS')",
    )
    .bind(rca.id)
    .first<{ count: number }>();
  assertValidRcaStatusTransition(
    rca.status,
    input.status,
    Number(row?.count ?? 0),
    rca.rootCause,
  );
  const now = operationNow(context);
  const results = await atomicBatch(
    getD1(),
    [
      getD1()
        .prepare(
          "UPDATE root_cause_analyses SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        )
        .bind(input.status, now, rca.id, input.version),
      getD1()
        .prepare(
          "INSERT INTO rca_events (id, root_cause_analysis_id, actor_id, event_type, from_status, to_status, note, created_at) VALUES (?, ?, ?, 'RCA_STATUS_CHANGED', ?, ?, ?, ?)",
        )
        .bind(
          operationId("event"),
          rca.id,
          context.session.userId,
          rca.status,
          input.status,
          "Estado de investigación actualizado.",
          now,
        ),
      getD1()
        .prepare(
          `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'RCA_STATUS_CHANGED', 'ROOT_CAUSE_ANALYSIS', ?, ?, ?, ?, ?)`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          rca.id,
          jsonValue({ status: rca.status }),
          jsonValue({ status: input.status }),
          context.requestId,
          now,
        ),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export async function completeRcaAction(
  context: OperationContext,
  number: string,
  input: { actionId: string },
): Promise<void> {
  assertPermission(context.session, "RCA_MANAGE");
  const rca = await findRca(context.session, number);
  if (["CLOSED", "CANCELLED"].includes(rca.status)) {
    throw new ApiContractError(
      409,
      "RCA_TERMINAL",
      "La RCA ya está finalizada.",
    );
  }
  const now = operationNow(context);
  const results = await atomicBatch(
    getD1(),
    [
      getD1()
        .prepare(
          `UPDATE rca_actions SET status = 'DONE', completed_at = ?, updated_at = ?
         WHERE id = ? AND root_cause_analysis_id = ? AND status IN ('OPEN','IN_PROGRESS')`,
        )
        .bind(now, now, input.actionId, rca.id),
      getD1()
        .prepare(
          "INSERT INTO rca_events (id, root_cause_analysis_id, actor_id, event_type, note, created_at) VALUES (?, ?, ?, 'RCA_ACTION_COMPLETED', ?, ?)",
        )
        .bind(
          operationId("event"),
          rca.id,
          context.session.userId,
          input.actionId,
          now,
        ),
    ],
    [0],
  );
  assertMutationApplied(results[0], "La acción ya no está abierta.");
}
