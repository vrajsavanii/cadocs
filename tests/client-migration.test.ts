import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";


describe("prompt-04: legacy client data migration", () => {
  it("backfills a legacy single GSTIN into a registration without claiming verification", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ca-legacy-client-"));
    try {
      const output = execFileSync(
        process.execPath,
        ["--import", "tsx", path.join("tests", "helpers", "legacy-migration-child.ts")],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            CA_DATA_DIR: dir,
            LEGACY_DIR: dir,
            NODE_ENV: "production",
            ADMIN_PASSWORD: "testpass123",
            MANAGER_PASSWORD: "testpass123",
            STAFF_PASSWORD: "testpass123",
            CA_ALLOW_EPHEMERAL: "",
            CA_DEMO_SEED: "",
            VERCEL: "",
          },
        },
      );
      const lastLine = output.trim().split(/\r?\n/).filter(Boolean).pop()!;
      const parsed = JSON.parse(lastLine) as {
        report: {
          legacy_clients: number;
          gst_registrations_backfilled: number;
          flagged_for_review: number;
          ambiguous: number;
        };
        registrations: Array<{
          kind: string;
          identifier?: string;
          identifier_masked: string;
          status: string;
          verification_status: string;
          migration_note: string;
        }>;
      };

      expect(parsed.report.legacy_clients).toBe(1);
      expect(parsed.report.gst_registrations_backfilled).toBe(1);
      expect(parsed.report.flagged_for_review).toBe(0);
      expect(parsed.registrations).toHaveLength(1);
      expect(parsed.registrations[0]!.kind).toBe("GST");
      expect(parsed.registrations[0]!.identifier).toBe("27AAPFC0939F1ZD");
      expect(parsed.registrations[0]!.identifier_masked).not.toContain("AAPFC");
      expect(parsed.registrations[0]!.verification_status).toBe("User entered");
      expect(parsed.registrations[0]!.migration_note).toContain("not externally verified");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
