import { afterAll, describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const { canAccess, isPublicPath } = await import("../lib/auth");
const { isCronAuthorized } = await import("../lib/cron-auth");

const priorSecret = process.env.CRON_SECRET;
afterAll(() => {
  if (priorSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = priorSecret;
});

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://nexagent.example/api/cron/recurrence", { headers });
}

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

  describe("DEF-001 regression: cron endpoints reject spoofable triggers", () => {
    it("rejects the header and user-agent marks that used to impersonate Vercel Cron", () => {
      process.env.CRON_SECRET = "regression-secret-1";
      expect(isCronAuthorized(cronRequest({ "x-vercel-cron": "1" }))).toBe(false);
      expect(isCronAuthorized(cronRequest({ "user-agent": "vercel-cron/2.0" }))).toBe(false);
      expect(isCronAuthorized(cronRequest({ "x-vercel-cron": "1", authorization: "Bearer wrong" }))).toBe(false);
    });

    it("authorises only the exact configured Bearer secret", () => {
      process.env.CRON_SECRET = "regression-secret-2";
      expect(isCronAuthorized(cronRequest({ authorization: "Bearer regression-secret-2" }))).toBe(true);
      // Same length, different secret — the timing-safe compare must reject it.
      expect(isCronAuthorized(cronRequest({ authorization: "Bearer regression-secret-3" }))).toBe(false);
      expect(isCronAuthorized(cronRequest({ authorization: "regression-secret-2" }))).toBe(false);
    });

    it("authorises no one while CRON_SECRET is unset", () => {
      process.env.CRON_SECRET = "";
      expect(isCronAuthorized(cronRequest())).toBe(false);
      expect(isCronAuthorized(cronRequest({ "x-vercel-cron": "1" }))).toBe(false);
    });
  });
});
