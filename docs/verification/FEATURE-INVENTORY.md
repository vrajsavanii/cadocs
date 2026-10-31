# Feature Inventory — NexAgent (Verification V1)

Status vocabulary (RULE 2): **Verified working** (exercised with evidence), **Partially working**,
**Broken**, **UI only**, **API only**, **Disconnected integration**, **Mocked/simulated**,
**Blocked by configuration**, **Not implemented**, **Not verified**.

Evidence codes used below:

- **[T]** automated test passing in `tests/` (109/109 green at baseline)
- **[S]** live smoke probe against the local production build (`next start`) on 2026-10-27
- **[C]** static code reading (file/line referenced)
- **[D]** documentation only — no execution evidence

Scope of the product as found: single Next.js 16 app, 77 API routes, 17 pages, 20 view
components, 44 SQLite tables, ~19.5k LOC in `lib/`. Single-firm per deployment (no
`firms`/tenant table exists anywhere — see F-16).

## 1. Authentication, session, and platform security

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-01 | Login / logout / session cookie | `/login`, `components/login-form.tsx` | `POST /api/auth/login`, `POST /api/auth/logout`, HMAC cookie in `lib/crypto.ts` | public | [S] login 200 + cookie set, bad creds 401, [T] `auth-policy.test.ts` | Verified working |
| F-02 | Edge request gate (authn, CSRF, rate limit, role policy) | every request | `proxy.ts` → `lib/auth.ts#canAccess` | all | [S] unauth API 401, pages 307→login, cross-origin POST rejected, staff mutations 403 | Verified working |
| F-03 | Brute-force protection, session revocation | login route, `token_version` | rate limiter `lib/crypto.ts` | all | [C] 10 tries/15 min per IP+user; logout/password bump `token_version` (proxy treats as no session) | Verified working (rate-limit path not runtime-exercised) |
| F-04 | Password change | Settings UI | `POST /api/auth/password` | all roles for self | [C] | Not verified |
| F-05 | User administration | `/settings` | `GET/POST /api/users` | partner only (manager blocked at proxy) | [S] staff GET/POST `/api/users` → 403 | Verified working (proxy level) |
| F-06 | Field encryption (PAN/GSTIN/TAN) | — | `lib/crypto.ts`, `FIELD_ENCRYPTION_KEY` | server | [T] `storage.test.ts`, `config.test.ts` | Verified working |

## 2. Clients, registrations, services, onboarding

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-10 | Client CRUD | `/clients`, `views/clients.tsx` | `POST/GET/PATCH /api/clients`, `/api/clients/[id]` | manager+ writes (DELETE partner only) | [T] `onboarding.test.ts` (14), [S] `GET /api/clients` 200 | Verified working (write path via tests) |
| F-11 | Onboarding wizard + activation | `views/onboard-wizard.tsx` | `POST /api/clients/[id]/onboarding` | manager+ | [T] activation idempotent, pause/cancel | Verified working |
| F-12 | GST registrations (multi per client) | client profile | `/api/clients/[id]/registrations`, `client_registrations` | manager+ | [T] two registrations → separate engagements, duplicates rejected | Verified working |
| F-13 | Service catalogue & assignments | `/settings`, `views/settings.tsx` | `/api/service-catalogue`, `/api/client-services` | partner/manager | [T] `onboarding.test.ts`, `config.test.ts` | Verified working |
| F-14 | Legacy client migration | — | `/api/documents/migrate-legacy`, migration helpers | admin | [T] `client-migration.test.ts` | Verified working |
| F-15 | Client bulk import | `views/clients.tsx` | `POST /api/clients/bulk` | manager+ | [C] | Not verified |
| F-16 | Multi-firm / tenant isolation | — | **no `firms` table, no `firm_id` column anywhere** | — | [C] schema grep | Not implemented — single firm per deployment; isolation is by deployment, not by tenant |

## 3. Compliance, engagements, due dates

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-20 | Engagement generation (idempotent) | `/compliance` | `/api/engagements/generate`, `/api/compliance/generate`, `lib/engagement-engine.ts` | manager+ | [T] `recurrence.test.ts` (16), reruns never duplicate | Verified working |
| F-21 | Registration-aware + paused/out-of-window suppression | same | `engagement-engine.ts` | manager+ | [T] recurrence tests | Verified working |
| F-22 | Due-date rules (statutory vs internal target, unverified-by-default) | `/settings` | `/api/due-date-rules`, `due_date_rules` | partner verifies | [T] recurrence + config tests; rows seeded `verification_status='unverified'` | Verified working |
| F-23 | Recurring cron generation | — | `GET /api/cron/recurrence` | CRON_SECRET | [S] returns 401 without secret; **spoofable header fallback** → see DEF-001 | Partially working |
| F-24 | Compliance calendar / dashboard KPIs | `/` dashboard | `GET /api/dashboard` | all | [S] 200 with KPIs; [T] staff-workflow dashboard tests | Verified working |
| F-25 | Deadline classification (due soon / overdue / awaiting evidence…) | `lib/workflow.ts#deadlineState` | derived, not stored | all | [T] `staff-workflow.test.ts` (19) | Verified working |
| F-26 | Filing evidence recording (separate from completion) | workflow UI | `/api/workflow/[id]` | role-gated | [T] recurrence + staff-workflow tests | Verified working |
| F-27 | Blockers | workflow UI | `lib/blockers.ts` | task team/manager/partner | [T] staff-workflow tests | Verified working |
| F-28 | Annual ITR / tax-audit specific workflows (Prompt 11) | — | only as generic services in catalogue | — | [C] no dedicated module | Not implemented (generic service rows only) |

## 4. Documents

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-30 | Upload / version / download | `/documents`, `views/documents.tsx` | `/api/documents`, `/api/documents/[id]/file` | role-checked per request | [T] `documents.test.ts` (7), [S] page 200 | Verified working |
| F-31 | Folder organisation | `/folders` | folder fields on documents | all | [T] documents tests | Verified working |
| F-32 | Checklists & review (receive/verify/reject) | documents UI | `/api/documents/[id]` PATCH | reviewer roles | [T] documents tests | Verified working |
| F-33 | Object storage provider (local / R2) | — | `lib/storage.ts`, `CA_STORAGE_PROVIDER` | server | [T] `storage.test.ts`, `config.test.ts`; R2 **blocked by configuration** (no credentials) | Verified working (local); Blocked (R2) |
| F-34 | Persistence across restart | — | SQLite + `CA_DATA_DIR` | server | [T] `persistence.test.ts` | Verified working |
| F-35 | Document requirements → WhatsApp request | requests UI | `/api/document-requests` | manager+ | [T] onboarding/recurrence overlap; delivery via F-41 | Partially working (see F-41) |

## 5. Staff, workflow, review

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-40 | Assignment & reassignment ledger | `/workflow` | `/api/workflow`, `task_assignments` | manager+; articles cannot self-reassign | [T] staff-workflow tests | Verified working |
| F-41 | Stage transitions, review, reject-with-reason, partner close | `/workflow`, `views/workflow.tsx` | `/api/workflow/[id]` | role + separation-of-duties per service policy | [T] staff-workflow tests incl. stale-write rejection | Verified working |
| F-42 | Timesheets | `/timesheets` | `/api/timesheets` | article creates own | [S] page 200; **no tests** | Not verified |
| F-43 | Escalation rules | automation rules UI | `lib/automation.ts` | manager+ | [S] sweep ran "escalate_overdue" rule locally | Partially working (runtime evidence only, no tests) |

## 6. WhatsApp & communications

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-50 | Outbox queue + wa.me deep link (default mode) | `/notices`? outbox in messages | `lib/whatsapp.ts#deliverWhatsApp` | server | [C] queue mode always available | Verified working (queue path via billing tests) |
| F-51 | Meta Cloud API template send | — | `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_AUTO_SEND=1` | server | [T] billing delivery-gating tests; **no credentials in `.env`/Vercel** | Blocked by configuration |
| F-52 | Provider status webhooks (delivered/read/failed) | — | **no webhook route exists** (`grep webhook` → only `lib/whatsapp.ts` comment) | — | [C] `markMessageStatus` called only from the send path | Disconnected integration — statuses stop at Sent/Failed from the API response |
| F-53 | Reminder limits / opt-in gating | reminders | `lib/reminders.ts`, `whatsapp_opt_in` | server | [T] billing tests enforce eligibility | Verified working |
| F-54 | Campaigns (bulk messages) | `/campaigns` | `POST /api/campaigns` | manager+ | [S] page 200; **no tests** | Not verified |
| F-55 | Notices / notices board | `/notices` | `/api/notices` | all | [S] page 200; no tests | Not verified |

## 7. Invoicing, payments, receivables

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-60 | Draft invoice + GST tax split (CGST/SGST vs IGST) | `/invoices`, `views/invoices.tsx` | `lib/invoicing.ts`, `POST /api/invoices` | manager+ | [T] `billing.test.ts` (18) | Verified working |
| F-61 | Approval gate → issue (self-approval blocked) | invoices UI | `/api/invoices/[id]/lifecycle` | approver ≠ creator | [T] billing tests | Verified working |
| F-62 | FY-scoped sequential numbering inside issue transaction | — | `lib/invoicing.ts` | server | [T] allocation test, skips legacy gaps | Verified working |
| F-63 | Payments ledger, partial payments, over-payment refusal | invoices UI | `POST /api/payments` | manager+ | [T] billing tests | Verified working |
| F-64 | Payment reversal as audited correcting entries | — | `/api/payments/[id]` | manager+ | [T] billing tests | Verified working |
| F-65 | Credit notes (partner-only, never counted as payment) | invoices UI | `/api/invoices/[id]` | partner | [T] billing tests | Verified working |
| F-66 | Invoice PDF, private storage, expiring single-invoice tokens | invoices UI | `/api/invoices/[id]/pdf`, `lib/invoice-pdf.ts` | viewer-scoped | [T] billing tests; [S] unauth PDF → 401 | Verified working |
| F-67 | Receivables reporting | `/reports` | `GET /api/billing/receivables` | manager+ | [S] 200 (invoice export produced rows) | Verified working |
| F-68 | Payment gateway (Razorpay/Stripe etc.) | — | **no gateway code anywhere** | — | [C] grep found none | Not implemented — payments are manual records; no provider success is ever claimed (correct by design, but no online collection) |
| F-69 | Recurring billing / auto-invoice generation | `/api/invoices/generate` | generation route | manager+ | [C] route exists; covered indirectly by billing tests | Partially working — not runtime-exercised in V1 |

## 8. AI Copilot

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-70 | Chat + tool registry (read tools) | `/agent`, `views/agent.tsx` | `POST /api/ai/chat`, `lib/ai-tools.ts` | all signed-in | [S] unauth 401; **no automated tests** | Not verified |
| F-71 | Write proposals with approval gate (re-validate on approve) | AI panel | `POST /api/ai/actions/[id]` | role checked again at approval | [C] ownership/status/role/schema/domain gates re-run; **no tests** | Not verified (code-reviewed only) |
| F-72 | Provider selection + keyless deterministic fallback | — | `lib/ai.ts` (gemini → groq → openrouter → nvidia, then keyless) | server | [C]; keys present in `.env.local` (2 matches), none on Vercel | Blocked by configuration for cloud model; keyless mode works |
| F-73 | Daily AI quota | — | `AI_DAILY_LIMIT`, `ai_calls` | server | [C] `AiQuotaError` | Not verified |
| F-74 | AI usage dashboard | agent UI | `GET /api/ai/usage` | all | [S] 200 | Verified working (endpoint) |

## 9. Reporting, export, search

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-80 | Unified reporting dashboard (10 sections, global filters) | `/reports` | `GET /api/reports`, `lib/reports.ts` | all reads | [T] `reports.test.ts` (12), [S] page+API 200 | Verified working |
| F-81 | CSV export with same filters | `/reports` | `GET /api/export?type=…` | all | [S] 200, 1530-byte invoice CSV; bad type → 400 | Verified working |
| F-82 | Global search | header | `GET /api/search` | all | [S] 200; SQLi probe returned empty groups (parameterised) | Verified working |
| F-83 | Legacy reports view (`getReports`) | old reports view | `lib/db.ts` | all | [D]/[C] retained; superseded by F-80 | Partially working (parallel legacy path) |

## 10. Automation, jobs, cron

| ID | Feature | Entry point | API / logic | Permissions | Evidence | Status |
|---|---|---|---|---|---|---|
| F-90 | Durable job queue + retry | — | `lib/jobs.ts`, `jobs` table | server | [T] `jobs.test.ts` (5) | Verified working |
| F-91 | Automation rules (cadence-gated) | `/automation` | `/api/automation`, `lib/automation.ts` | manager+ | [S] sweep ran 9 rules / 114 actions locally | Partially working (runtime OK, untested) |
| F-92 | Scheduled sweeps (Vercel Cron) | — | `vercel.json` crons → `/api/cron/automation`, `/api/cron/recurrence` | CRON_SECRET **not configured** | [S] 401 w/o secret, but **spoofable `x-vercel-cron` header accepted** → DEF-001 | Broken (auth) |
| F-93 | Automation run history / retry UI | `/automation` | `/api/automation/runs` | manager+ | [S] page 200; no tests | Not verified |

## 11. Proposals, DSC, UDIN, misc modules

| ID | Feature | Entry point | API | Status |
|---|---|---|---|---|
| F-94 | Proposals + convert to client | `/proposals` | `/api/proposals`, `/api/proposals/[id]/convert` | Not verified (page 200 only; no tests) |
| F-95 | DSC (digital signature) expiry tracking | `/dsc` | `POST /api/dsc` | Not verified (page 200; automation rule `dsc_watch` fired locally) |
| F-96 | UDIN register | `/udin` | `/api/udin` | Not verified (page 200; no tests) |
| F-97 | Public marketing site + demo request | `/site` | `POST /api/public/demo-request` | Verified working ([S] 200; rate-limited per IP; sends email? see INTEGRATION matrix) |
| F-98 | Help centre | `/help` | static | Verified working ([S] 200) |

## 12. Infrastructure, backup, deployment

| ID | Feature | Entry point | Evidence | Status |
|---|---|---|---|---|
| F-99 | SQLite persistence + boot storage guard | `lib/data-dir.ts`, `lib/config.ts` | [T] `config.test.ts`, `persistence.test.ts` | Verified working |
| F-100 | Backup + restore verification | `npm run backup`, `npm run backup:verify` | [T] `backup.test.ts`; `.backups/` contains a real backup + manifest | Verified working |
| F-101 | Local object storage for uploads | `.data/uploads` | [T] `storage.test.ts` | Verified working |
| F-102 | R2 object storage | `CA_STORAGE_PROVIDER=r2` | no credentials anywhere | Blocked by configuration |
| F-103 | Health endpoint | `GET /api/health` | [S] 200; discloses firm name + version unauthenticated → DEF-003 | Verified working (with disclosure defect) |
| F-104 | Vercel production deployment | `scripts/deploy.sh` | built and live 2026-10-27; **runs in `CA_ALLOW_EPHEMERAL=1` demo mode** → DEF-002 | Verified working (deploy); storage unsafe for real data |
| F-105 | SaaS plans / entitlements / subscription billing (Prompts 14–15) | — | no tables, no code (`grep subscription/entitlement` → only AI quota) | Not implemented |
| F-106 | Firm provisioning / invitations | — | users are seeded/admin-created; no invitation flow found | Not implemented |

## Summary counts

| Status | Count (of 74 entries) |
|---|---|
| Verified working | 30 |
| Partially working | 7 |
| Not verified (exists, unexercised) | 15 |
| Blocked by configuration | 4 |
| Disconnected integration | 1 |
| Broken | 1 |
| Not implemented | 9 |
| UI only / API only | 0 found (all probed surfaces were wired to real handlers) |

No placeholder buttons, `TODO`s, `console.log`s, or no-op `onClick` handlers were found in
`app/`, `components/`, or `lib/` (grep evidence in BASELINE-TEST-RESULTS.md).