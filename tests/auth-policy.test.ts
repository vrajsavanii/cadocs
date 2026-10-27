import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const { canAccess, isPublicPath } = await import("../lib/auth");

describe("prompt-05: edge request policy", () => {
  it("lets scheduled sweeps reach the cron handlers, which authorise themselves", () => {
    expect(isPublicPath("/api/cron/recurrence")).toBe(true);
    expect(isPublicPath("/api/cron/automation")).toBe(true);
    // Everything else in the API still demands a session at the proxy.
    expect(isPublicPath("/api/engagements")).toBe(false);
    expect(isPublicPath("/api/engagements/generate")).toBe(false);
    expect(isPublicPath("/api/due-date-rules")).toBe(false);
    expect(isPublicPath("/api/auth/login")).toBe(true);
  });

  it("keeps engagement generation manager+ for articles at the edge", () => {
    expect(canAccess("article", "POST", "/api/engagements/generate")).toBe(false);
    expect(canAccess("article", "POST", "/api/engagements/preview")).toBe(false);
    expect(canAccess("article", "GET", "/api/engagements/runs")).toBe(true);
    expect(canAccess("article", "PATCH", "/api/engagements/COMP-001")).toBe(true);
    expect(canAccess("manager", "POST", "/api/engagements/generate")).toBe(true);
    expect(canAccess("partner", "POST", "/api/engagements/generate")).toBe(true);
  });

  it("still denies article writes outside their own work", () => {
    expect(canAccess("article", "POST", "/api/clients")).toBe(false);
    expect(canAccess("article", "DELETE", "/api/engagements/COMP-001")).toBe(false);
    expect(canAccess("article", "POST", "/api/due-date-rules")).toBe(false);
    expect(canAccess("manager", "POST", "/api/settings")).toBe(false);
  });
});
