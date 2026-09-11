import { getD1 } from "@/db";
import {
  assertIncidentCanConvert,
  assertIncidentTransition,
  type IncidentStatus,
} from "@/lib/domain/incidents";
import { assertPermission } from "@/lib/domain/permissions";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import {
  atomicBatch,
  commitIdempotentOperation,
  assertMutationApplied,
  assertLocationScope,
  jsonValue,
  nextPlantNumber,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type IncidentRow = {
  id: string;
  status: IncidentStatus;
  version: number;
  assetId: string | null;
  functionalLocationId: string;
  priority: string | null;
  classification: string | null;
  title: string;
  description: string;
  severity: string;
  initialImpact: string;
  reportedById: string;
  reportedAt: string;
};

async function findIncident(
  session: DemoUserSession,
  incidentId: string,
): Promise<IncidentRow> {
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      `
      SELECT id, status, version, asset_id AS assetId,
        functional_location_id AS functionalLocationId,
        triage_priority AS priority, classification, title, description,
        severity, initial_impact AS initialImpact,
        reported_by_id AS reportedById, reported_at AS reportedAt
      FROM incidents
      WHERE id = ? AND organization_id = ? AND site_id = ?
      LIMIT 1
    `,
    )
    .bind(incidentId, session.organizationId, session.siteId)
    .first<IncidentRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "INCIDENT_NOT_FOUND",
      "La incidencia no existe en el centro activo.",
    );
  }
  await assertLocationScope(session, row.functionalLocationId);
  return row;
}

export async function resolveIncidentContext(
  session: DemoUserSession,
  functionalLocationId: string,
  assetId: string | null,
): Promise<{ functionalLocationId: string; assetId: string | null }> {
  await ensureDatabase();
  if (assetId) {
    const asset = await getD1()
      .prepare(
        `SELECT id, functional_location_id AS functionalLocationId
         FROM assets WHERE id = ? AND organization_id = ? AND site_id = ? AND status != 'RETIRED'`,
      )
      .bind(assetId, session.organizationId, session.siteId)
      .first<{ id: string; functionalLocationId: string }>();
    if (!asset) {
      throw new ApiContractError(
        422,
        "INVALID_ASSET",
        "El activo no pertenece al centro activo o está retirado.",
      );
    }
    await assertLocationScope(session, asset.functionalLocationId);
    return {
      assetId: asset.id,
      functionalLocationId: asset.functionalLocationId,
    };
  }
  const location = await getD1()
    .prepare(
      `SELECT id FROM functional_locations
       WHERE id = ? AND organization_id = ? AND site_id = ? AND status = 'ACTIVE'`,
    )
    .bind(functionalLocationId, session.organizationId, session.siteId)
    .first<{ id: string }>();
  if (!location) {
    throw new ApiContractError(
      422,
      "INVALID_LOCATION",
      "La ubicación funcional no pertenece al centro activo.",
    );
  }
  await assertLocationScope(session, location.id);
  return { assetId: null, functionalLocationId: location.id };
}

export async function reportIncident(
  context: OperationContext,
  input: {
    functionalLocationId: string;
    assetId: string | null;
    title: string;
    description: string;
    severity: string;
    initialImpact: string;
    origin: string;
  },
): Promise<{ id: string; number: string }> {
  assertPermission(context.session, "INCIDENT_REPORT");
  const now = operationNow(context);
  const resolved = await resolveIncidentContext(
    context.session,
    input.functionalLocationId,
    input.assetId,
  );
  const number = await nextPlantNumber(context.session, "INC", now);
  const id = operationId("incident");
  const eventId = operationId("incident-event");
  const auditId = operationId("audit");
  const notificationPrefix = operationId("notification");
  const db = getD1();
  await commitIdempotentOperation(
    context,
    [
      db
        .prepare(
          `INSERT INTO incidents (
          id, organization_id, site_id, functional_location_id, asset_id,
          reported_by_id, number, title, description, severity, initial_impact,
          status, origin, classification, triage_priority, reported_at,
          triaged_at, resolved_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, NULL, NULL, ?, NULL, NULL, 1, ?, ?)`,
        )
        .bind(
          id,
          context.session.organizationId,
          context.session.siteId,
          resolved.functionalLocationId,
          resolved.assetId,
          context.session.userId,
          number,
          input.title,
          input.description,
          input.severity,
          input.initialImpact,
          input.origin,
          now,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO incident_events
          (id, incident_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'INCIDENT_REPORTED', NULL, 'NEW', 'Incidencia registrada.', ?)`,
        )
        .bind(eventId, id, context.session.userId, now),
      db
        .prepare(
          `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'INCIDENT_REPORTED', 'INCIDENT', ?, NULL, ?, ?, ?)`,
        )
        .bind(
          auditId,
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          id,
          jsonValue({ number, severity: input.severity, status: "NEW" }),
          context.requestId,
          now,
        ),
      db
        .prepare(
          `INSERT INTO notifications
          (id, organization_id, site_id, user_id, title, body, severity,
           entity_type, entity_id, read_at, created_at)
         SELECT ? || '-' || user.id, ?, ?, user.id, ?, ?, ?, 'INCIDENT', ?, NULL, ?
         FROM users user
         INNER JOIN memberships membership ON membership.user_id = user.id
         WHERE membership.organization_id = ?
           AND membership.status = 'ACTIVE'
           AND membership.role_key IN ('MAINTENANCE_MANAGER','SUPERVISOR')
           AND ? IN ('CRITICAL','HIGH')`,
        )
        .bind(
          notificationPrefix,
          context.session.organizationId,
          context.session.siteId,
          `Nueva incidencia ${input.severity === "CRITICAL" ? "crítica" : "prioritaria"}`,
          `${number} · ${input.title}`,
          input.severity === "CRITICAL" ? "CRITICAL" : "WARNING",
          id,
          now,
          context.session.organizationId,
          input.severity,
        ),
    ],
    { id, number },
  );
  return { id, number };
}

export type TriageAction =
  "START_TRIAGE" | "REQUEST_INFO" | "ACCEPT" | "REJECT" | "CLOSE";

export async function triageIncident(
  context: OperationContext,
  incidentId: string,
  input: {
    action: TriageAction;
    assetId?: string | null;
    priority?: string;
    classification?: string;
    note?: string;
  },
): Promise<{ status: IncidentStatus }> {
  assertPermission(context.session, "INCIDENT_TRIAGE");
  const current = await findIncident(context.session, incidentId);
  const now = operationNow(context);
  let nextStatus: IncidentStatus = current.status;
  let noteKind = "TRIAGE_DECISION";
  if (input.action === "START_TRIAGE") nextStatus = "IN_TRIAGE";
  if (input.action === "ACCEPT") nextStatus = "ACCEPTED";
  if (input.action === "REJECT") nextStatus = "REJECTED";
  if (input.action === "CLOSE") nextStatus = "CLOSED";
  if (input.action === "REQUEST_INFO") {
    noteKind = "INFO_REQUEST";
    if (current.status === "NEW") nextStatus = "IN_TRIAGE";
    if (!input.note?.trim()) {
      throw new ApiContractError(
        422,
        "NOTE_REQUIRED",
        "Indica qué información adicional necesitas.",
      );
    }
  }
  if (nextStatus !== current.status) {
    assertIncidentTransition(current.status, nextStatus);
  }
  if (["REJECT", "CLOSE"].includes(input.action) && !input.note?.trim()) {
    throw new ApiContractError(
      422,
      "NOTE_REQUIRED",
      "Documenta brevemente la decisión de triage.",
    );
  }
  const resolved = input.assetId
    ? await resolveIncidentContext(
        context.session,
        current.functionalLocationId,
        input.assetId,
      )
    : {
        assetId: current.assetId,
        functionalLocationId: current.functionalLocationId,
      };
  if (
    input.action === "ACCEPT" &&
    (!resolved.assetId || !input.priority || !input.classification)
  ) {
    throw new ApiContractError(
      422,
      "INCOMPLETE_TRIAGE",
      "Selecciona activo, prioridad y tipo de trabajo antes de aceptar.",
    );
  }
  const nextVersion = current.version + 1;
  const eventId = operationId("incident-event");
  const noteId = operationId("incident-note");
  const auditId = operationId("audit");
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE incidents SET
          status = ?, asset_id = ?, functional_location_id = ?,
          triage_priority = COALESCE(?, triage_priority),
          classification = COALESCE(?, classification),
          triaged_at = CASE WHEN ? IN ('IN_TRIAGE','ACCEPTED','REJECTED') THEN ? ELSE triaged_at END,
          resolved_at = CASE WHEN ? IN ('REJECTED','CLOSED') THEN ? ELSE resolved_at END,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          nextStatus,
          resolved.assetId,
          resolved.functionalLocationId,
          input.priority ?? null,
          input.classification ?? null,
          nextStatus,
          now,
          nextStatus,
          now,
          now,
          current.id,
          context.session.organizationId,
          context.session.siteId,
          current.status,
          current.version,
        ),
      db
        .prepare(
          `INSERT INTO incident_events
          (id, incident_id, actor_id, event_type, from_status, to_status, note, created_at)
         SELECT ?, id, ?, ?, ?, ?, ?, ? FROM incidents
         WHERE id = ? AND version = ?`,
        )
        .bind(
          eventId,
          context.session.userId,
          input.action === "REQUEST_INFO"
            ? "INFORMATION_REQUESTED"
            : "TRIAGE_UPDATED",
          current.status,
          nextStatus,
          input.note ?? "Triage actualizado.",
          now,
          current.id,
          nextVersion,
        ),
      db
        .prepare(
          `INSERT INTO incident_notes (id, incident_id, actor_id, kind, body, created_at)
         SELECT ?, id, ?, ?, ?, ? FROM incidents
         WHERE id = ? AND version = ? AND ? IS NOT NULL`,
        )
        .bind(
          noteId,
          context.session.userId,
          noteKind,
          input.note ?? "",
          now,
          current.id,
          nextVersion,
          input.note?.trim() ? input.note : null,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, ?, ?, ?, ?, 'INCIDENT', id, ?, ?, ?, ? FROM incidents
         WHERE id = ? AND version = ?`,
        )
        .bind(
          auditId,
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          `INCIDENT_${input.action}`,
          jsonValue({ status: current.status, assetId: current.assetId }),
          jsonValue({
            status: nextStatus,
            assetId: resolved.assetId,
            priority: input.priority ?? current.priority,
            classification: input.classification ?? current.classification,
          }),
          context.requestId,
          now,
          current.id,
          nextVersion,
        ),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
  return { status: nextStatus };
}

function dueAtForPriority(priority: string, now: string): string {
  const hours: Record<string, number> = {
    P1_EMERGENCY: 2,
    P2_URGENT: 8,
    P3_HIGH: 24,
    P4_NORMAL: 72,
    P5_LOW: 168,
  };
  return new Date(
    new Date(now).getTime() + (hours[priority] ?? 72) * 3_600_000,
  ).toISOString();
}

export async function convertIncidentToWorkOrder(
  context: OperationContext,
  incidentId: string,
): Promise<{ id: string; number: string }> {
  assertPermission(context.session, "INCIDENT_TRIAGE");
  const incident = await findIncident(context.session, incidentId);
  assertIncidentCanConvert({
    status: incident.status,
    assetId: incident.assetId,
    priority: incident.priority,
    classification: incident.classification,
  });
  const now = operationNow(context);
  const number = await nextPlantNumber(context.session, "OT", now);
  const workOrderId = operationId("wo");
  const nextVersion = incident.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE incidents SET status = 'CONVERTED', resolved_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ?
           AND status = 'ACCEPTED' AND version = ?`,
        )
        .bind(
          now,
          now,
          incident.id,
          context.session.organizationId,
          context.session.siteId,
          incident.version,
        ),
      db
        .prepare(
          `INSERT INTO work_orders (
          id, organization_id, site_id, asset_id, functional_location_id,
          requested_by_id, incident_id, number, title, description, status,
          priority, type, source, requested_at, due_at, planned_start,
          planned_end, actual_start, actual_end, completed_at, closed_at,
          cancelled_at, estimated_minutes, downtime_minutes, diagnosis,
          solution, failure_mode, failure_cause, production_impact, version,
          created_at, updated_at
        )
        SELECT ?, organization_id, site_id, asset_id, functional_location_id,
          reported_by_id, id, ?, title, description, 'APPROVED', triage_priority,
          classification, 'REQUEST', reported_at, ?, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, 60, 0, NULL, NULL, NULL, NULL,
          CASE initial_impact
            WHEN 'FULL_STOP' THEN 'FULL_STOP'
            WHEN 'REDUCED_SPEED' THEN 'REDUCED_SPEED'
            ELSE 'NONE' END,
          1, ?, ?
        FROM incidents WHERE id = ? AND version = ? AND status = 'CONVERTED'`,
        )
        .bind(
          workOrderId,
          number,
          dueAtForPriority(incident.priority!, now),
          now,
          now,
          incident.id,
          nextVersion,
        ),
      ...[
        [
          "CREATED_FROM_INCIDENT",
          null,
          "REQUESTED",
          "Orden creada desde incidencia.",
        ],
        [
          "STATUS_CHANGED",
          "REQUESTED",
          "TRIAGE",
          "Triage heredado de la incidencia.",
        ],
        [
          "STATUS_CHANGED",
          "TRIAGE",
          "APPROVED",
          "Incidencia aceptada y orden aprobada.",
        ],
      ].map(([eventType, fromStatus, toStatus, note], index) =>
        db
          .prepare(
            `INSERT INTO work_order_events
            (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
           SELECT ?, id, ?, ?, ?, ?, ?, ? FROM work_orders WHERE id = ? AND incident_id = ?`,
          )
          .bind(
            operationId(`wo-event-${index + 1}`),
            context.session.userId,
            eventType,
            fromStatus,
            toStatus,
            note,
            now,
            workOrderId,
            incident.id,
          ),
      ),
      db
        .prepare(
          `INSERT INTO incident_events
          (id, incident_id, actor_id, event_type, from_status, to_status, note, created_at)
         SELECT ?, id, ?, 'INCIDENT_CONVERTED_TO_WORK_ORDER', 'ACCEPTED', 'CONVERTED', ?, ?
         FROM incidents WHERE id = ? AND version = ?`,
        )
        .bind(
          operationId("incident-event"),
          context.session.userId,
          `Convertida en ${number}.`,
          now,
          incident.id,
          nextVersion,
        ),
      ...[
        [
          "INCIDENT_CONVERTED",
          "INCIDENT",
          incident.id,
          { status: "ACCEPTED" },
          { status: "CONVERTED", workOrderId, number },
        ],
        [
          "WORK_ORDER_CREATED",
          "WORK_ORDER",
          workOrderId,
          null,
          { number, status: "APPROVED", incidentId: incident.id },
        ],
      ].map(([action, entityType, entityId, previousValue, newValue]) =>
        db
          .prepare(
            `INSERT INTO audit_entries
            (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
             previous_value, new_value, request_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND incident_id = ?)`,
          )
          .bind(
            operationId("audit"),
            context.session.organizationId,
            context.session.siteId,
            context.session.userId,
            action as string,
            entityType as string,
            entityId as string,
            previousValue === null ? null : jsonValue(previousValue),
            jsonValue(newValue),
            context.requestId,
            now,
            workOrderId,
            incident.id,
          ),
      ),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
  const insertedOrder = results[1];
  if (Number(insertedOrder?.meta?.changes ?? 0) !== 1) {
    throw new ApiContractError(
      409,
      "INCIDENT_CONVERSION_FAILED",
      "La incidencia ya se ha convertido o cambió durante la operación.",
    );
  }
  return { id: workOrderId, number };
}
