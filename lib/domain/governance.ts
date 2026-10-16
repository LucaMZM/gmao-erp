import { DomainInvariantError } from "./errors";

export const enterprisePermissions = [
  "identity.manage",
  "inventory.manage",
  "incident.report",
  "incident.triage",
  "workorder.create",
  "workorder.assign",
  "workorder.execute",
  "workorder.close",
  "inventory.reserve",
  "inventory.consume",
  "procurement.request",
  "procurement.approve",
  "procurement.receive",
  "preventive.manage",
  "planning.manage",
  "reliability.rca.manage",
  "asset.manage",
  "audit.read",
  "reports.read",
  "reports.export",
  "governance.read",
] as const;

export type EnterprisePermission = (typeof enterprisePermissions)[number];

export type AccessScope = {
  siteIds: readonly string[];
  currentSiteId: string;
  fullAreaAccess: boolean;
  areaIds: readonly string[];
  fullWarehouseAccess: boolean;
  warehouseIds: readonly string[];
};

export type ScopedResource = {
  siteId: string;
  areaId?: string | null;
  ancestorAreaIds?: readonly string[];
  warehouseId?: string | null;
};

export function hasPermission(
  permissionCodes: readonly string[],
  permission: EnterprisePermission,
): boolean {
  return permissionCodes.includes(permission);
}

export function assertEnterprisePermission(
  permissionCodes: readonly string[],
  permission: EnterprisePermission,
): void {
  if (!hasPermission(permissionCodes, permission)) {
    throw new DomainInvariantError(
      "FORBIDDEN_OPERATION",
      "Tu perfil no permite realizar esta acción.",
    );
  }
}

export function canAccessResource(
  scope: AccessScope,
  resource: ScopedResource,
): boolean {
  if (
    resource.siteId !== scope.currentSiteId ||
    !scope.siteIds.includes(resource.siteId)
  ) {
    return false;
  }
  if (
    resource.warehouseId &&
    !scope.fullWarehouseAccess &&
    !scope.warehouseIds.includes(resource.warehouseId)
  ) {
    return false;
  }
  if (resource.areaId && !scope.fullAreaAccess) {
    const candidates = [resource.areaId, ...(resource.ancestorAreaIds ?? [])];
    if (!candidates.some((id) => scope.areaIds.includes(id))) return false;
  }
  return true;
}

export function assertResourceAccess(
  scope: AccessScope,
  resource: ScopedResource,
): void {
  if (!canAccessResource(scope, resource)) {
    throw new DomainInvariantError(
      "FORBIDDEN_OPERATION",
      "El recurso está fuera de tu ámbito operativo.",
    );
  }
}

export type IntegrityFinding = {
  code: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  count: number;
  title: string;
  guidance: string;
};

export function integrityStatus(findings: readonly IntegrityFinding[]) {
  const critical = findings.reduce(
    (sum, finding) =>
      sum + (finding.severity === "CRITICAL" ? finding.count : 0),
    0,
  );
  const warning = findings.reduce(
    (sum, finding) =>
      sum + (finding.severity === "WARNING" ? finding.count : 0),
    0,
  );
  return {
    state: critical > 0 ? "CRITICAL" : warning > 0 ? "ATTENTION" : "HEALTHY",
    critical,
    warning,
  } as const;
}
