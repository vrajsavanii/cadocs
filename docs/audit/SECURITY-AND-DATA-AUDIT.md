# Security & Data Audit — NexAgent / CADocs (24 Oct 2026)

Severities: **Critical** (blocks production launch) · **High** (exploitable / privacy breach) · **Medium** (degrades guarantees) · **Low** (hardening).

## Findings

| ID | Severity | Area | Finding | Evidence | Remediation |
|---|---|---|---|---|---|
| S1 | **High** | Export / authorization | `GET /api/export?type=clients` emits **plaintext PAN and GSTIN** for every client; reads allowed for all authenticated roles, so the article role can bulk-download all decrypted identifiers. Encryption-at-rest is defeated at one authenticated endpoint. | [app/api/export/route.ts](../../app/api/export/route.ts) lines 20–21 (`c.gst_number, c.pan` in headers) + `canAccess` read-all | Role-gate the identifier columns (partner-only) or strip them; add an audit entry per identifier-bearing export; add a test |
| S2 | **Critical** | Persistence | SQLite DB, AES/HMAC key files and uploaded files all live in `/tmp/ca-suite` on Vercel: lost on cold start, not shared between instances. A stolen-from-`/tmp` key+DB pair is also impossible to rotate meaningfully because it is regenerated per instance. | [lib/data-dir.ts](../../lib/data-dir.ts), [lib/crypto.ts](../../lib/crypto.ts) | Persistent shared Postgres (or volume); object storage for files; keys from a managed secret store |
| S3 | **High** | Tenancy | No firm/isolation boundary anywhere: single global DB, no `firm_id`, every accessor global. Any future second firm would cross-read all records. | schema inventory | `firms` + `firm_id` everywhere; scope in accessors (not UI); enforced by tests |
| S4 | **Medium** | File upload | Allow-list by extension + 8 MB cap only; no magic-byte/MIME sniffing, no AV scan; `zip` allowed (zip-bomb/polyglot risk low while only staff can upload, but real once a client portal exists). Path handling itself is safe (`path.basename`, prefix assertion, `no-store`, attachment disposition). | [app/api/documents/[id]/file/route.ts](../../app/api/documents/[id]/file/route.ts) | Content-sniff validation; later, AV scan at object-storage hook |
| S5 | **Medium** | Rate limiting | Brute-force and write brakes are in-memory, **per process**. Serverless multi-instance hosting multiplies the effective limits per attacker. | [lib/crypto.ts](../../lib/crypto.ts) `rateLimit` | Per-IP limits at edge/proxy or a shared store (same DB as S2) |
| S6 | **Medium** | Key management | `decryptField()` returns `""` on a wrong/rotated key — identifier columns silently blank. `SESSION_SECRET` < 32 chars silently falls back to the generated key instead of failing fast. | [lib/crypto.ts](../../lib/crypto.ts) `decryptField`, `loadKey` | Log + metric on decrypt failure; refuse short env secrets with a distinct error; rotation procedure documented |
| S7 | **Medium** | Sessions/main-loop | [proxy.ts](../../proxy.ts) — the `x-pathname` pass-through making `proxy.ts` usable mid-request is sound; but `getSessionUser()` swallows all exceptions to `null` (fail-closed — correct), and cookie flags verified only over HTTPS (`Secure` conditional). No MFA, no re-auth for highly privileged actions (client delete, user create). | [proxy.ts](../../proxy.ts), [lib/auth.ts](../../lib/auth.ts) | Step-up confirmation for deletes/user changes; session listing + force-logout in UI exists in Settings — verify parity in tests |
| S8 | **Medium** | Jobs/background | Cron loop authorization is a single bearer secret (`CRON_SECRET`) or Vercel's cron markers. Acceptable, but a leaked secret triggers the full sweep (writes, queues) without a user context; no per-call audit marker beyond "Scheduled sweep". | [app/api/cron/automation/route.ts](../../app/api/cron/automation/route.ts) | Fine as-is for single-firm; for SaaS add per-firm lock-release schema so two instances can't double-run (see G-idempotency note) |
| S9 | **Medium** | Data protection | Audit log stores actions but some writes embed free-text notes that can contain identifiers; `ai_calls`/`ai_actions` redact identifiers properly. Session/`ai` logs verified clean. Dashboard pages render decrypted identifiers — correct per role, but databases still hold them (correctly encrypted). Whole-product DPDP posture is good; needs a retention/erasure spec (`@`-guarded delete exists; erasure of backups unhandled). | [lib/db.ts](../../lib/db.ts) audit writes | Define retention windows; extend erasure to the object store + backups |
| S10 | **Low** | Headers | Strict CSP verified in `next.config.ts`; risks now only fitra. `X-Frame-Options: DENY` conflicts with the public *site*'s animations only. No loobs. | [next.config.ts](../../next.config.ts) | — |
| S11 | **Low** | Form hardening | Public demo-lead route has rate limit 5/IP/10 min, honeypot, cross-origin refusal; login has 10/IP+user/15 min. Good. | routes verified | — |
| S12 | **Info** | Secret hygiene | Gredistribusproved: `.env` holds the Vercel token locally (gitignored ✔); secrets never appear in chat/logs in the audited routes. | `.gitignore`, deployment script exclusions | — |

## What is done well (verified)

- Password hashing (scrypt + per-password salt + timing-safe compare), session signing (HMAC-SHA256, exp enforced), and revocation (`token_version` bump on logout/password change) — all in [lib/crypto.ts](../../lib/crypto.ts)/[lib/auth.ts](../../lib/auth.ts).
- CSRF (Origin check on mutating methods) applied inside the same middleware as role enforcement.
- Security headers comprehensive: CSP, nosniff, DENY framing, strict referrer, HSTS in production, opener isolation, permissions policy ([next.config.ts](../../next.config.ts)).
- Encryption-at-rest with format-tagged AES-256-GCM and legacy-migration, machine-local 0600 keys with env override.
- Sign-in brute-force throttle + audit of every auth action; write-quality per-request role check in `proxy.ts` before any handler runs.

## Required tests before removing findings

1. Role-matrix script: every route × every role × method asserts expected status (kills S1, S7 ambiguities, protects S3 refactor).
2. Upload abuse: unsupported extension, oversize, empty, oddly-named (unicode), re-referenced ID (kills S4 regressions).
3. Tenant fixture: Firm A vs Firm B on the same DB — every accessor cross-firm read returns nothing/logged (kills S3).
4. Export audit: an article-session `/api/export?type=clients` must not contain PAN/GSTIN post-fix (kills S1).
5. Session lessons: password change invalidates all cookies (`token_version` replay → 401).
