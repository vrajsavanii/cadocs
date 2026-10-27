# Executive Summary — NexAgent / CADocs Code Audit

**Date:** 24 October 2026 · **Mode:** audit only · **Build state:** typecheck exit 0, production build exit 0

## Maturity assessment

**A functional, security-conscious single-firm practice suite with two genuine production blockers.**
The software is substantially more complete than its own (v3.1) report claims: the engagement/service engine, a stage-gated filing workflow with server-side role segregation, a hard-capped (3) reminder engine, idempotent auto-billing on completed work, and a real WhatsApp Cloud API template-send path all exist in code. What is missing is the ability to *store anything durably on the current host* and to *separate one firm's data from another's* — the two things that separate a demo from sellable software.

## Confirmed strengths

1. **Auth is real and complete** — [proxy.ts](../../proxy.ts) + [lib/auth.ts](../../lib/auth.ts) + [lib/crypto.ts](../../lib/crypto.ts): scrypt passwords, HMAC-SHA256 httpOnly cookies (12 h, SameSite=Lax), `token_version` revocation, login throttle (10/IP+user/15 min), CSRF Origin check, 300 writes/min per-user brake, security headers incl. CSP/HSTS.
2. **Role policy extended beyond the report** — article staff can write to the workflow stages they own ([lib/auth.ts](../../lib/auth.ts) `canAccess`), and [lib/workflow.ts](../../lib/workflow.ts) enforces partner-only sign-off and no closure without an acknowledgement number.
3. **Reminder policy is stronger than proposed** — cap 3 enforced twice ([lib/reminders.ts](../../lib/reminders.ts) `HARD_CAP`, [lib/engagements-db.ts](../../lib/engagements-db.ts) `clampCap`), per-request state, durable DB-backed daily sweep.
4. **Crypto done properly** — AES-256-GCM field format with version tag, legacy-plaintext migration, 0600 key files in `.data/`, env override, timing-safe compares ([lib/crypto.ts](../../lib/crypto.ts)).
5. **AI layer does not exceed its authority** — bounded loop (4 rounds/8 calls), writes are pending `ai_action`s with re-validation on approve, role-scoped tools, quota + audit ([lib/ai-agent.ts](../../lib/ai-agent.ts), [lib/ai-tools.ts](../../lib/ai-tools.ts)).
6. **Keyless degradation everywhere** — deterministic fallbacks for AI, automation planning and reminders; no external-account dependency to operate.

## Critical blockers (verified)

| # | Blocker | Evidence |
|---|---|---|
| B1 | **Ephemeral production persistence.** All runtime state (SQLite DB, keys, uploads) goes to `/tmp/ca-suite` when `VERCEL` is set ([lib/data-dir.ts](../../lib/data-dir.ts)). Cold starts lose client records, uploaded files and queued messages; instances do not share state. | `lib/data-dir.ts`; live deployment checks |
| B2 | **No tenant isolation.** Single global DB, no `firm_id` on any table, no firm-scoped access layer. Selling to multiple firms is unsafe by construction. | schema inventory (21 tables, none firm-scoped) |

## Major risks (existing, not blockers)

- **R1 (High):** `GET /api/export?type=clients` includes **plaintext GSTIN and PAN** in the CSV, and reads are permitted for every authenticated role — the lowest-privilege article role can export all decrypted identifiers ([app/api/export/route.ts](../../app/api/export/route.ts)). The at-rest AES encryption is defeated at the application boundary.
- **R2 (Medium):** Uploaded files are validated by **extension only** (allow-list, 8 MB) with no content/MIME sniffing or malware scanning ([app/api/documents/[id]/file/route.ts](../../app/api/documents/[id]/file/route.ts)). `zip` is accepted; uploaded files are served to staff only (no client portal), which limits exposure.
- **R3 (Medium):** The rate limiter is **in-memory per process** ([lib/crypto.ts](../../lib/crypto.ts)). On multi-instance serverless hosting, login-brute-force and write brakes are per-instance and can be multiplied.
- **R4 (Medium):** `decryptField()` **fails soft to an empty string** on a wrong/rotated key ([lib/crypto.ts](../../lib/crypto.ts)) — PAN/GSTIN silently vanish from the UI instead of alerting. Desirable for uptime, dangerous for unnoticed key loss.
- **R5 (Medium):** No migrations ledger (`CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER`s in boot path, [lib/db.ts](../../lib/db.ts)) — two environments can silently drift.
- **R6 (Medium):** WhatsApp delivery is *provider-accepted*, not delivered: no status/inbound webhook, no stored provider message id, no retry/idempotency for sends (outbound template path exists and is honest about this in its own header comments, [lib/whatsapp.ts](../../lib/whatsapp.ts)).
- **R7 (Medium):** Escalation gap: after the 3rd document reminder the engine stops without creating a staff follow-up task.
- **R8 (Low):** No automated tests of any kind; every behaviour above is code-inspection-verified, not regression-tested.

## Is the current deployment suitable for genuine client records?

**No.** Blocker B1 alone makes the Vercel deployment demo-grade: data is lost on cold start and not shared across instances. With B1 fixed and R1 remediated, the architecture (single-firm, controlled) is workable for one firm; multi-firm sale requires B2 first.

## Five highest-priority actions

1. **Move runtime state to a persistent, shared store** (managed Postgres recommended; per-firm SQLite-on-volume acceptable for a small first cohort) — replaces B1.
2. **Add `firm_id` + server-side firm scoping** on every table/query/route — replaces B2.
3. **Fix R1:** exclude PAN/GSTIN (or watermark/regulate) the clients CSV per role; article/manager must not bulk-export identifiers.
4. **Introduce `vitest` + a minimal acceptance-suite harness** (the plan's 15 scenarios against a temp `CA_DATA_DIR`), CI-gated — everything later depends on this.
5. **Wire WhatsApp delivery + inbound webhooks and provider-message idempotency** so "sent" becomes "delivered" and replies become tasks.

## What this audit did NOT do

No feature changes, no migrations, no deployments, no dependency changes, no reseeds. Build and typecheck were run read-only. `CA-automation-main/` (legacy reference tree) was inspected for schema contrast only and excluded from maturity judgement.
