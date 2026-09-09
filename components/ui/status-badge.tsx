import {
  criticalityLabels,
  priorityLabels,
  statusLabels,
  typeLabels,
} from "@/lib/presentation";

type BadgeKind = "status" | "priority" | "criticality" | "type";

function toneFor(value: string, kind: BadgeKind): string {
  if (kind === "priority") {
    if (value === "P1_EMERGENCY" || value === "P2_URGENT") return "critical";
    if (value === "P3_HIGH") return "warning";
    return "neutral";
  }
  if (kind === "criticality") {
    if (value === "CRITICAL") return "critical";
    if (value === "HIGH") return "warning";
    if (value === "LOW") return "quiet";
    return "neutral";
  }
  if (kind === "type")
    return value === "CORRECTIVE"
      ? "steel"
      : value === "PREVENTIVE"
        ? "accent"
        : "neutral";
  if (["DOWN", "CANCELLED", "REJECTED"].includes(value)) return "critical";
  if (
    [
      "DEGRADED",
      "PAUSED",
      "WAITING_PART",
      "WAITING_VENDOR",
      "SUBMITTED",
      "PARTIALLY_RECEIVED",
      "IN_TRANSIT",
    ].includes(value)
  )
    return "warning";
  if (
    [
      "ACTIVE",
      "OPERATING",
      "COMPLETED",
      "CLOSED",
      "ACCEPTED",
      "CONVERTED",
      "DONE",
      "RECEIVED",
      "POSTED",
    ].includes(value)
  )
    return "success";
  if (["NEW", "IN_TRIAGE", "INVESTIGATING", "ACTIONS_DEFINED"].includes(value))
    return "warning";
  if (["IN_PROGRESS", "ASSIGNED", "VERIFICATION", "SENT"].includes(value))
    return "accent";
  return "neutral";
}

export function StatusBadge({
  value,
  kind = "status",
}: {
  value: string;
  kind?: BadgeKind;
}) {
  const labels =
    kind === "priority"
      ? priorityLabels
      : kind === "criticality"
        ? criticalityLabels
        : kind === "type"
          ? typeLabels
          : statusLabels;
  return (
    <span className={`status-badge tone-${toneFor(value, kind)}`}>
      <i aria-hidden="true" />
      {labels[value] ?? value}
    </span>
  );
}
