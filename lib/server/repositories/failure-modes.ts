import { queryAll, type TenantScope } from "./shared";

export type FailureModeOption = {
  id: string;
  code: string;
  name: string;
  category: string;
};

export async function getFailureModeOptions(
  scope: TenantScope,
): Promise<FailureModeOption[]> {
  return queryAll<FailureModeOption>(
    "SELECT id,code,name,category FROM failure_modes WHERE organization_id=? AND status='ACTIVE' ORDER BY category,name LIMIT 200",
    [scope.organizationId],
  );
}
