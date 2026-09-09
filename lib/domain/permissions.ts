import { DomainInvariantError } from "./errors";

export const operationCapabilities = [
  "INCIDENT_REPORT",
  "INCIDENT_TRIAGE",
  "WORK_ORDER_ASSIGN",
  "WORK_ORDER_SCHEDULE",
  "WORK_ORDER_EXECUTE",
  "WORK_ORDER_COMPLETE",
  "WORK_ORDER_CLOSE",
  "WORK_ORDER_CANCEL",
  "MATERIAL_PLAN",
  "MATERIAL_RESERVE",
  "MATERIAL_CONSUME",
  "DOWNTIME_MANAGE",
  "MAINTENANCE_PLAN_CREATE",
  "MAINTENANCE_PLAN_MANAGE",
  "MAINTENANCE_PLAN_GENERATE",
  "METER_RECORD",
  "PLANNER_MANAGE",
  "RCA_CREATE",
  "RCA_MANAGE",
  "PURCHASE_REQUISITION_CREATE",
  "PURCHASE_REQUISITION_APPROVE",
  "PURCHASE_ORDER_MANAGE",
  "INVENTORY_RECEIVE",
  "INVENTORY_TRANSFER",
  "FIELD_CHECKLIST",
  "FIELD_EVIDENCE",
  "FIELD_SAFETY_ACKNOWLEDGE",
  "SHIFT_HANDOVER_CREATE",
] as const;

export type OperationCapability = (typeof operationCapabilities)[number];

export const legacyPermissionMap: Record<
  OperationCapability,
  import("./governance").EnterprisePermission
> = {
  INCIDENT_REPORT: "incident.report",
  INCIDENT_TRIAGE: "incident.triage",
  WORK_ORDER_ASSIGN: "workorder.assign",
  WORK_ORDER_SCHEDULE: "workorder.assign",
  WORK_ORDER_EXECUTE: "workorder.execute",
  WORK_ORDER_COMPLETE: "workorder.execute",
  WORK_ORDER_CLOSE: "workorder.close",
  WORK_ORDER_CANCEL: "workorder.close",
  MATERIAL_PLAN: "inventory.reserve",
  MATERIAL_RESERVE: "inventory.reserve",
  MATERIAL_CONSUME: "inventory.consume",
  DOWNTIME_MANAGE: "workorder.execute",
  MAINTENANCE_PLAN_CREATE: "preventive.manage",
  MAINTENANCE_PLAN_MANAGE: "preventive.manage",
  MAINTENANCE_PLAN_GENERATE: "preventive.manage",
  METER_RECORD: "workorder.execute",
  PLANNER_MANAGE: "planning.manage",
  RCA_CREATE: "reliability.rca.manage",
  RCA_MANAGE: "reliability.rca.manage",
  PURCHASE_REQUISITION_CREATE: "procurement.request",
  PURCHASE_REQUISITION_APPROVE: "procurement.approve",
  PURCHASE_ORDER_MANAGE: "procurement.approve",
  INVENTORY_RECEIVE: "procurement.receive",
  INVENTORY_TRANSFER: "procurement.receive",
  FIELD_CHECKLIST: "workorder.execute",
  FIELD_EVIDENCE: "workorder.execute",
  FIELD_SAFETY_ACKNOWLEDGE: "workorder.execute",
  SHIFT_HANDOVER_CREATE: "workorder.execute",
};

const roleCapabilities: Record<string, readonly OperationCapability[]> = {
  MAINTENANCE_MANAGER: operationCapabilities,
  PLANNER: [
    "INCIDENT_REPORT",
    "INCIDENT_TRIAGE",
    "WORK_ORDER_ASSIGN",
    "WORK_ORDER_SCHEDULE",
    "MATERIAL_PLAN",
    "MATERIAL_RESERVE",
    "MAINTENANCE_PLAN_CREATE",
    "MAINTENANCE_PLAN_MANAGE",
    "MAINTENANCE_PLAN_GENERATE",
    "METER_RECORD",
    "PLANNER_MANAGE",
    "RCA_CREATE",
    "PURCHASE_REQUISITION_CREATE",
  ],
  RELIABILITY_ENGINEER: [
    "INCIDENT_REPORT",
    "MAINTENANCE_PLAN_CREATE",
    "MAINTENANCE_PLAN_MANAGE",
    "MAINTENANCE_PLAN_GENERATE",
    "METER_RECORD",
    "RCA_CREATE",
    "RCA_MANAGE",
    "PURCHASE_REQUISITION_CREATE",
    "FIELD_EVIDENCE",
  ],
  SUPERVISOR: [
    "INCIDENT_REPORT",
    "INCIDENT_TRIAGE",
    "WORK_ORDER_ASSIGN",
    "WORK_ORDER_SCHEDULE",
    "WORK_ORDER_EXECUTE",
    "WORK_ORDER_COMPLETE",
    "WORK_ORDER_CANCEL",
    "MATERIAL_PLAN",
    "MATERIAL_RESERVE",
    "MATERIAL_CONSUME",
    "DOWNTIME_MANAGE",
    "MAINTENANCE_PLAN_GENERATE",
    "METER_RECORD",
    "PLANNER_MANAGE",
    "RCA_CREATE",
    "PURCHASE_REQUISITION_CREATE",
    "FIELD_CHECKLIST",
    "FIELD_EVIDENCE",
    "FIELD_SAFETY_ACKNOWLEDGE",
    "SHIFT_HANDOVER_CREATE",
  ],
  TECHNICIAN: [
    "INCIDENT_REPORT",
    "WORK_ORDER_EXECUTE",
    "WORK_ORDER_COMPLETE",
    "MATERIAL_CONSUME",
    "DOWNTIME_MANAGE",
    "METER_RECORD",
    "PURCHASE_REQUISITION_CREATE",
    "FIELD_CHECKLIST",
    "FIELD_EVIDENCE",
    "FIELD_SAFETY_ACKNOWLEDGE",
    "SHIFT_HANDOVER_CREATE",
  ],
  WAREHOUSE: [
    "INCIDENT_REPORT",
    "MATERIAL_PLAN",
    "MATERIAL_RESERVE",
    "MATERIAL_CONSUME",
    "PURCHASE_REQUISITION_CREATE",
    "INVENTORY_RECEIVE",
    "INVENTORY_TRANSFER",
  ],
  VIEWER: ["INCIDENT_REPORT"],
  OPERATOR: ["INCIDENT_REPORT"],
  PROCUREMENT: [
    "PURCHASE_REQUISITION_CREATE",
    "PURCHASE_REQUISITION_APPROVE",
    "PURCHASE_ORDER_MANAGE",
    "INVENTORY_RECEIVE",
    "INVENTORY_TRANSFER",
  ],
  ADMIN: operationCapabilities,
};

export function can(
  subject: string | { roleKey: string; permissionCodes?: readonly string[] },
  capability: OperationCapability,
): boolean {
  const roleKey = typeof subject === "string" ? subject : subject.roleKey;
  return typeof subject !== "string" && subject.permissionCodes
    ? subject.permissionCodes.includes(legacyPermissionMap[capability])
    : (roleCapabilities[roleKey]?.includes(capability) ?? false);
}

export function assertPermission(
  subject: string | { roleKey: string; permissionCodes?: readonly string[] },
  capability: OperationCapability,
): void {
  const roleKey = typeof subject === "string" ? subject : subject.roleKey;
  const grantedByPolicy =
    typeof subject !== "string" && subject.permissionCodes
      ? subject.permissionCodes.includes(legacyPermissionMap[capability])
      : can(roleKey, capability);
  if (!grantedByPolicy) {
    throw new DomainInvariantError(
      "FORBIDDEN_OPERATION",
      "Tu rol no permite realizar esta acción en el centro actual.",
    );
  }
}
