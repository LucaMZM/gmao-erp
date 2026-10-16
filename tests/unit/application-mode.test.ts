import { describe, expect, it } from "vitest";
import { resolveApplicationMode } from "@/lib/domain/application-mode";

describe("application mode", () => {
  it("permits explicit demo mode only", () => {
    expect(resolveApplicationMode("DEMO")).toBe("DEMO");
    expect(resolveApplicationMode("PRODUCTION")).toBe("PRODUCTION");
  });

  it("fails closed when missing or invalid", () => {
    expect(resolveApplicationMode(undefined)).toBe("PRODUCTION");
    expect(() => resolveApplicationMode("demo")).toThrow();
  });
});
