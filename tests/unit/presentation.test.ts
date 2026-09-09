import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, formatDateTime } from "@/lib/presentation";

describe("plant time presentation", () => {
  it("uses the plant calendar across the UTC midnight boundary", () => {
    const instant = "2026-08-25T22:15:00.000Z";
    expect(dateKeyInTimeZone(instant, "Europe/Madrid")).toBe("2026-08-26");
    expect(formatDateTime(instant, "Europe/Madrid")).toContain("26 ago");
    expect(formatDateTime(instant)).toContain("26 ago");
  });
});
