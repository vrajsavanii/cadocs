# Database & API Inventory — NexAgent / CADocs (24 Oct 2026)

## 1. Database technology (verified)

- **Engine:** SQLite via Node's built-in `node:sqlite` (no third-party driver) — `lib/db.ts`.
- **Mode:** rollback journal (deliberate, so the dev file-watcher is not triggered by WAL shared-memory writes).
- **Location:** `lib/data-dir.ts` → `CA_DATA_DIR` if set, else `/tmp/ca-suite` when `VERCEL`, else `.data/`.
- **Keys/uploads:** `.data/field.key`, `.data/session.key` (0600, AES-GCM + HMAC); uploads in `.data/uploads/`.

## 2. Tables (21) and relationships

Legacy/practice tables in [lib/db.ts](../../lib/db.ts) plus engagement-layer tables:

| Table | PK | Notable FKs / references | Uniqueness |
|---|---|---|---|
| `clients` | `client_id` | — | — |
| `compliance` | `compliance_id` | `client_id` → clients, `service_id` → client_services | — |
| `documents` | `doc_id` | `client_id`, `request_id` → document_requests, `compliance_id` | — |
| `invoices` | `invoice_id` | `client_id`, `compliance_id` (billing lineage) | **unique on `compliance_id`** (idempotent auto-billing) |
| `payments` | `payment_id` | `invoice_id` | per-invoice numbering (`PAY-INV-…-2`) |
| `messages` | `message_id` | `related_type/related_id` (polymorphic) | `automation_key` present but **no unique index** |
| `udin` | `udin_id` | client/filing linkage | duplicate rejection on entry |
| `dsc` | `dsc_id` | — | — |
| `notices` | `notice_id` | client | — |
| `timesheets` | `timesheet_id` | user, client | — |
| `proposals` | `proposal_id` | client OR lead/prospect fields | — |
| `campaigns` | `campaign_id` | audience JSON | — |
| `users` | `user_id` | `token_version` (revocation) | — |
| `settings` | `key` | — | single row per key |
| `audit_log` | auto-inc | actor, action | append-only |
| `ai_calls` | auto-inc | user, action, provider | metrics |
| `ai_actions` | `action_id` | user, tool, args JSON, status | lifecycle pending→approved/rejected/failed |
| `automation_rules` | `rule_id` | created_by | — |
| `automation_runs` | `run_id` | rule_id | detail JSON |
| `client_services` | `service_id` | `client_id` | one service per (client, service_code) enforced in code |
| `document_requests` | `request_id` | client, service | per-request reminder state |
| `task_events` | auto-inc | compliance_id, actor | stage-transition history |

**Implied but unenforced relationships:** most `*_id` columns rely on application code; only the invoice `compliance_id` unique index is a true constraint. No `FOREIGN KEY` declarations. Deleting a client cascades in application code (guarded delete).

## 3. API routes (57) and method surface

Grouped by prefix with the effective roles (partner P / manager M / article A):

| Prefix | Methods | Roles | Auth path |
|---|---|---|---|
| `/api/auth/{login,logout,password}` | POST/PATCH | public → all | special-case in `proxy.ts`; login throttled 10/15 min |
| `/api/clients` (+`/[id]`) | GET/POST/PATCH/DELETE | read all; write M+ (P/M); delete P only; article 403 | centre policy `canAccess` |
| `/api/client-services` (+`[id]`) | GET/POST/PATCH | M+ (P/M) | route-level + `canAccess` |
| `/api/compliance` (+`[id]`, `/generate`) | GET/POST/PATCH | M+; generate M+ | |
| `/api/workflow` (+`[id]`) | GET/PATCH | all (stage role check inside `lib/workflow.ts`) | stage-role enforced server-side |
| `/api/document-requests` (+`[id]`) | GET/POST/PATCH | A+ owns stages | article write allowed |
| `/api/documents` (+`[id]`, `[id]/file`) | GET/POST/PATCH/DELETE(multipart) | A+ for stages; A cannot DELETE request rows | upload allow-list ext/8 MB |
| `/api/invoices` (+`[id]`, `/generate`) | GET/POST/PATCH | M+ | |
| `/api/payments` | GET/POST | M+ | |
| `/api/timesheets` (+`[id]`) | GET/POST/PATCH | A+ own | |
| `/api/notices`, `/api/udin`, `/api/dsc` | GET/POST/PATCH | M+ | |
| `/api/messages` (+`[id]`) | GET/PATCH | A+ own/log reads; PATCH outbox state M+ | |
| `/api/campaigns` | GET/POST | M+ | |
| `/api/automation`, `/automation/[id]`, `/automation/run`, `/automation/runs`, `/automation/plan` | GET/POST/PATCH/DELETE | M+/P (create/run) | |
| `/api/ai/{agent,assist,actions/[id],brief,chat,draft,classify,usage}` | GET/POST | all signed-in (role-scoped tools internally) | quota per user |
| `/api/cron/automation` | GET | bearer `CRON_SECRET` / Vercel markers | outside session gate by name |
| `/api/export?type=…` | GET | **all roles read; contains identifier leak (S1)** | |
| `/api/dashboard`, `/api/reports`, `/api/settings`, `/api/search`, `/api/users`, `/api/health`, `/api/public/demo-request` | GET/POST/PUT | various; settings/users M-/P; health public | |
| `/api/proposals` (+`[id]`, `[id]/convert`) | GET/POST/PATCH | M+ | |

## 4. Workflow state fields in the schema

- `compliance.stage` (documents/preparation/review/filing/signoff/done), `status`, `acked` via `ack_number`, `filed_date`, `due_date`.
- `client_services.status`, `owner`, `reviewer`, `next_cycle_on`, `reminder_cap` (≤3), `reminder_gap_days`.
- `document_requests.status` (Not Requested/Requested/Received/**Accepted/Rejected**), `reminder_number`, `next_reminder_at`.
- `messages.status` (Queued/Sent/Failed/…), `reminder_number`, `automation_key`, `error`.
- `ai_actions.status` (pending/approved/rejected/failed), ownership + bound args.
- `automation_runs.status/summary/detail`, `last_run_at`, `run_count` on rules.

## 5. Missing relationships / constraints (action list for the roadmap)

1. `firm_id` on all business tables (blocker for SaaS; single-firm seed to pilot).
2. `FOREIGN KEY` declarations + `ON DELETE` policies matching the guarded-cancel logic.
3. Unique index on `messages.automation_key` (cross-instance idempotency).
4. Indexes: `compliance(client_id, due_date, stage)`, `document_requests(client_id, status)`, `messages(related_type, related_id, status)`, `invoice(client_id, status)`.
5. `client_gstins` table (multi-registration) + AY-vs-FY explicit columns for ITR periods.
6. `service_templates` (versioned checklists per firm) and `jobs` (durable queue for retries).
7. Migration ledger: `schema_migrations` / `PRAGMA user_version`-based runner replacing ad-hoc boot-path `ALTER`s.

## 6. Verified negative / constraint facts

- `MAX(suffix)+1` ID generation avoids resurrection-after-delete (audit fix present).
- Unauthenticated reach is limited to `[isPublicPath]`: `/login`, `/privacy`, `/site`, `/api/auth/login`, `/api/health`, `/api/public/demo-request`, `/api/cron/automation` (self-authenticated), static assets.
- **Every** mutating API path (except the two public ones) is gated by `proxy.ts`; no route handler trusts `x-pathname` for authorization.
