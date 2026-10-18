# CADocs — Audit, Market Research & Product Roadmap

**Date:** 17 October 2026
**Scope:** the migrated Next.js application in this workspace, compared with the Indian and global CA practice-management market.

---

## 1. Executive summary

Small Indian CA firms do not lack tax-filing software. What they lack is an **operational layer that keeps client obligations, documents, deadlines, fees and communication in one place**. Today that layer is usually a mix of Excel, WhatsApp, email and memory. The consequences are late document collection, missed or near-miss deadlines, fee leakage and partners who cannot see what is blocked or unbilled.

This application already covers the breadth of a practice (14 modules, live data, server-rendered pages) and runs without any external account. The audit found that the **breadth is real but several workflows stop at a placeholder**: "Remind"/"Chase" buttons only show a toast, documents are tracked without files, invoices cannot be paid partially or printed as GST invoices, proposals cannot become clients, and there are no ageing/utilization reports or exports. UDIN entry also fabricates a reference instead of recording the real ICAI number.

This release closes those gaps with recorded reminders, a client 360, GST invoice documents with payment history, document uploads, recurring compliance generation, reports with CSV export and hardened identifiers. The report also sets out what remains (auth/roles, client portal, e-signature, paid gateway, provider-backed WhatsApp) and why.

---

## 2. The problem worth solving

### 2.1 The daily reality

Practitioner evidence is consistent: the work is not the filing, it is the **coordination around the filing**.

- "Delays in getting client bank statements and missing purchase invoices consume far more operational time in follow-ups than the actual accounting and compliance work." — [CAclubindia, CA month-end pain points](https://www.caclubindia.com/forum/consultation-616131.asp)
- Documents arrive "in pieces, some are missing, deadline is close" after repeated WhatsApp messages. — [CAclubindia, document collection discussion](https://www.caclubindia.com/forum/building-a-tool-to-simplify-client-document-collection-for-ca-firms-8212-would-love-your-feedback-615110.asp)
- Clients ask "Mera ITR kab file hoga?" while staff manually check status across disconnected tools. — [CAclubindia, follow-up automation discussion](https://www.caclubindia.com/forum/built-a-simple-tool-to-automate-client-document-follow-up-amp-itr-tracking-8212-need-feedback-from-practi-616009.asp)
- Recovery is uncomfortable: an ₹18,000 fee unpaid for a year is resolved by repeated requests, not by leverage. — [CAclubindia, unpaid fees thread](https://www.caclubindia.com/forum/how-to-lock-the-account--601245.asp)
- WIP and debtors are "lock-up" that ties up cash; chargeable vs total hours are core practice KPIs. — [IFAC, practice KPIs](https://www.ifac.org/knowledge-gateway/discussion/monitoring-and-benchmarking-key-performance-indicators-part-one)
- Client data is spread across WhatsApp, email, drives and staff laptops, raising DPDPA and security questions. — [CAclubindia, client consent under DPDPA](https://www.caclubindia.com/forum/client-consent-under-dpdpa-is-client-sharing-pan-aadhaar-and-form-16-enough--615528.asp)
- Ransomware targeting NAS devices used by CA firms is an active operational risk. — [TaxGuru / I4C advisory](https://taxguru.in/corporate-law/advisory-ransomware-groups-targeting-nas-devices-ca-consulting-firms.html)

### 2.2 The specific jobs to be done

1. **Know what is due** — per client, per obligation (GST, TDS, ITR, ROC, audit), with owner and status.
2. **Collect inputs without chasing manually** — request, track, upload, verify, remind.
3. **Never lose money** — invoice, collect (including part payments), age receivables, chase in one click.
4. **See the firm** — WIP, utilization, realization, client profitability, pipeline conversion.
5. **Keep a defensible record** — who changed what, which UDIN/DSC belongs to which engagement, what was sent to the client.
6. **Adopt without a project** — no per-seat pricing shock, no data migration project, no client training.

---

## 3. Market landscape

### 3.1 Products and published pricing

| Product | Positioning | Published price | Notable strengths | Noted weaknesses / limits |
|---|---|---|---|---|
| **Winman CA-ERP** | Indian tax/audit production suite | ~₹9,850/yr single-user listing | ITR/TDS/audit computation, imports, regulatory updates | Desktop-first; users report multi-user lag and a steep UI; no modern client workflow ([reviews](https://www.softwaresuggest.com/winman-ca-erp/reviews)) |
| **Jamku** | Indian CA/CS office management | ₹6,500/yr up to 5 users; ₹1,300/user/yr | Compliance, tasks, timesheets, portal, billing, mobile | Smaller ecosystem; WhatsApp automation/portal depth unverified ([pricing](https://madrecha.com/jamku/pricing/)) |
| **ERPCA** | Indian practice suite | ₹250/user/month, min 5 users | Compliance calendar, portal, GST invoices, payment links, realization reporting, WhatsApp add-on | Cost at scale; WhatsApp is paid add-on ([pricing](https://www.erpca.com/pricing/)) |
| **Zoho Practice** | Global/India practice suite | ₹2,950–₹8,950/org/month (5 users included) | Tasks, WhatsApp, portal (Premium), Zoho Sign, ledgers | Portal is premium; GST fee invoicing via Zoho Books ([pricing](https://www.zoho.com/practice/pricing/)) |
| **Karbon** | Global workflow/collaboration | $59–$89/user/month | Workflow, portal, email, analytics, mobile apps | Manual WIP sync, reporting complaints; no India GST/statutory calendar ([review](https://www.trustradius.com/products/karbon/reviews)) |
| **TaxDome** | Global all-in-one | $800–$1,200/seat/year (US) | Pipelines, portal, e-sign, invoicing, mobile | Setup is hard ("Set up is tough"); US-centric ([testimonials](https://taxdome.com/testimonials)) |
| **Canopy** | Global all-in-one | $74–$149/user/month | Portal, e-sign, billing, utilization reporting | US tax focus; no India compliance ([pricing](https://www.getcanopy.com/pricing/)) |
| **Financial Cents** | Small-firm workflow | $19–$69/user/month | Templates, portal, e-sign, reminders | Lighter reporting; US-centric ([pricing](https://financial-cents.com/pricing/)) |
| **Jetpack Workflow** | Recurring work/deadlines | $40–$59/seat/month | Strong recurring task templates | Not an official tax calendar; no billing/portal ([pricing](https://jetpackworkflow.com/pricing/)) |
| **Vyapar TaxOne (Suvit)** | Indian data/GST automation | ₹10,000/yr | Document collection, WhatsApp, Tally, GST recon | Feature availability mixed ("coming soon" vs pricing page) ([pricing](https://taxone.vyapar.com/pricing)) |
| **ClearTax TaxCloud** | ITR production | Quote-based | Bulk ITR, imports, reminders | Not a full PMS ([product](https://cleartax.in/taxcloud)) |

### 3.2 What the market treats as table stakes

From vendor documentation and product pages:

- Recurring task/compliance templates with owner, due date, checklist and reminders ([Zoho](https://www.zoho.com/practice/help/tasks/tasks-preferences.html)).
- Client record with services, contacts, assigned staff ([Zoho](https://www.zoho.com/practice/help/clients/creating-clients.html)).
- Client portal / secure document exchange ([Karbon](https://karbonhq.com/feature/client-portal/), [TaxDome](https://taxdome.com/product-client-experience)).
- GST-aware invoicing and payment collection ([CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html), [Zoho Invoice](https://www.zoho.com/in/invoice/)).
- WhatsApp/email reminders with a record of what was sent ([Meta opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-tips)).
- Roles and audit trail ([Zoho users/roles](https://www.zoho.com/practice/help/settings/users-and-roles.html)).
- Time → WIP → realization reporting ([Karbon analytics](https://karbonhq.com/feature/analytics/), [IFAC KPIs](https://www.ifac.org/knowledge-gateway/discussion/monitoring-and-benchmarking-key-performance-indicators-part-one)).
- Import/export and credible migration ([Zoho export](https://www.zoho.com/practice/help/clients/managing-client-profiles.html)).
- India-specific registers: UDIN, DSC, filing acknowledgements ([ICAI UDIN](https://www.icai.org/post/aligning-the-time-limit-of-generating-udin-from-15days-to-60days)).

### 3.3 Where the market is weak

- **Price and complexity**: global suites cost $59–$149 per user per month and require configuration projects; Indian ERP suites charge per user with minimum seats.
- **India specificity**: global tools do not maintain Indian statutory calendars, GST invoice formats or UDIN/DSC registers.
- **WhatsApp reality**: firms and clients live on WhatsApp; most tools either ignore it or sell it as a paid add-on with Meta template charges.
- **Data ownership**: cloud-only, per-seat lock-in; no local-first option.
- **Honesty of "sent" status**: automated sends require provider credentials; smaller tools often simulate success.

### 3.4 Verified feature inventory — Indian suites (vendor pages, 2026)

Legend: ✓ evidenced on a vendor page, ◐ partial / plan-limited / add-on, ? not evidenced (not proof of absence).

| Capability | Winman CA-ERP | Jamku | ERPCA | Zoho Practice | TaxOne (Suvit) |
|---|---|---|---|---|---|
| Compliance/task calendar | ◐ tax due dates, not firm-wide calendar | ✓ tasks, calendar, reminders | ✓ statutory workflows | ◐ recurring tasks; India calendar unverified | ? |
| Recurring task templates | ? | ◐ templates in setup material | ✓ workflow checklists | ✓ | ? |
| Client master / 360 | ◐ MIS + filed/not-filed reports | ✓ client groups and profiles | ✓ named Client 360 | ✓ workspace (plan limits) | ◐ PMS labelled "coming soon" |
| Client portal | ? | ✓ free portal + iOS app | ✓ branded portal + app | ◐ Premium tier | ? |
| Document requests / uploads | ? | ◐ uploads, storage paid add-on | ✓ client uploads + reminders | ✓ (portal Premium) | ◐ WhatsApp collection, availability unclear |
| E-signature | ? | ◐ Digital Sign tracking (not signing) | ? approvals only | ◐ Zoho Sign add-on | ? |
| GST invoicing | ? billing only | ◐ billing/receipts, GST format unverified | ✓ GST + e-invoice | ◐ via Zoho Books | ? (GST data, not fee invoices) |
| Payment links / collection | ? | ◐ receivables report | ✓ Razorpay links | ? not in Practice | ? |
| WhatsApp automation | ? | ◐ bulk SMS/email; chat separate | ◐ paid add-on | ✓ templated messages | ◐ promoted but "coming soon" |
| Time tracking / timesheets | ? | ✓ | ✓ | ✓ | ? |
| WIP / utilization / realization | ? | ◐ profitability/efficiency reports | ✓ unbilled WIP, utilization, realization | ◐ timesheets feed billing | ? |
| Receivables ageing | ? | ◐ receivables management | ✓ 30/60/90 ageing | ◐ books-level ageing | ? |
| Roles / permissions | ◐ password, locking | ◐ billing/report access | ✓ | ✓ | ? |
| Audit trail | ? | ? | ◐ peer-review trail | ✓ activity logs | ? |
| Mobile app | ? | ✓ Android/iOS | ✓ client app + attendance | ? not confirmed | ? |
| UDIN / DSC registers | ◐ DSC used for filing | ◐ DSC folder/expiry tracking | ? | ? | ? |
| Statutory portal integration | ✓ e-filing, 26AS/AIS/TIS | ? | ✓ GST API | ◐ Zoho Finance only | ✓ GST portal/IMS |
| Import / export | ✓ ITR JSON, Excel, Tally | ✓ import assistance | ✓ Excel/Tally onboarding | ◐ XLS/CSV exports | ✓ Excel/PDF/Tally |
| Public API | ? | ? | ? (GST connector only) | ◐ webhooks/Deluge | ? (GST API only) |
| Published price | unlisted on buy page | ₹6,500/yr (5 users) → ₹1,300–1,500/user/yr; storage extra | ₹250/user/mo, min 5, annual | ₹2,950 / ₹8,950 per org/mo (5 users) | ₹10,000/yr promo |

**What this means for the build:** ERPCA is the closest Indian benchmark and confirms the table stakes — client 360, portal uploads, recurring compliance workflows, time/WIP, ageing and payment links. Winman is a tax-production tool, not an operations suite. Jamku validates the low-price office-management niche but charges separately for storage and does not clearly automate WhatsApp. Zoho Practice gates the portal and broad client management behind Premium, and its Indian statutory calendar is not evidenced. TaxOne's practice-management claims are partly "coming soon". The unserved middle is a fast, local-first operations layer with real document custody, real reminder records and India-native registers at no per-seat cost.

**Positioning opportunity:** a fast, local-first, WhatsApp-native operations layer for 2–25 person Indian CA firms — no per-seat pricing, no client onboarding project, real records of what was sent, and India-native registers. That is the gap this product targets.

---

## 4. Product audit (verified against the running build)

### 4.1 What works

Verified with production build (`next start`), API calls and browser interaction:

- 15 server-rendered module pages, 45 route handlers; all return 200 with no console/server errors.
- SQLite data layer, seed data, audit log, derived overdue statuses, global search (`⌘K`), toasts, modals, responsive shell.
- CRUD + status flows for clients, leads, compliance, documents, invoices, UDIN, DSC, notices, timesheets, proposals, campaigns.
- Proposal generation from a lead, print/copy, and pipeline sync (Sent → lead "Proposal Sent", Accepted → lead "Won").
- Campaign composer with audience targeting, token resolution and WhatsApp/email deep links.
- AI copilot with live-data fallback (optional Groq).
- Production latency 13–62 ms TTFB, 45–112 KB HTML on seeded data.

### 4.2 Defects and incomplete features found

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | High | "Remind"/"Chase" buttons are fake: they show a toast but send nothing and record nothing (compliance, documents, invoices). | `components/views/compliance.tsx`, `documents.tsx`, `invoices.tsx` |
| 2 | High | Documents have no files: status-only tracking; no upload, download, or client-facing collection. The #1 cited pain point is unaddressed. | `components/views/documents.tsx`, `app/api/documents/route.ts` |
| 3 | High | Invoices are ledger rows only: no printable GST invoice, no SAC/place of supply, no payment recording or partial payments, no payment history. | `components/views/invoices.tsx`, `lib/db.ts` |
| 4 | High | UDIN "auto-generates" a fabricated reference (`YY` + timestamp digits) and accepts duplicates; the real ICAI number is never captured in the form. | `app/api/udin/route.ts` |
| 5 | Medium | Clients cannot be edited or removed, and there is no client 360 (compliance, invoices, documents, proposals, contact history). | `components/views/clients.tsx` |
| 6 | Medium | Proposals cannot be converted into a client/engagement; accepted work must be re-keyed. | `components/views/proposals.tsx` |
| 7 | Medium | No recurring compliance generation: monthly GST/TDS tasks must be created one by one. | `components/views/compliance.tsx` |
| 8 | Medium | No reports or exports: no ageing, realization, utilization, compliance health or CSV/Excel download. | app-wide |
| 9 | Medium | ID generation uses `COUNT(*)` (duplicates after delete) and invoices use a timestamp suffix (collision risk). | `lib/db.ts` |
| 10 | Medium | No auth/roles; settings page says "Single-partner demo (open)". | `components/views/settings.tsx` |
| 11 | Low | Invoice `[id]` route has no GET; detail cannot be fetched independently. | `app/api/invoices/[id]/route.ts` |
| 12 | Low | "Reminder sent"/"queued" copy overstates what happened, which is a trust problem in a practice tool. | same as #1 |
| 13 | Low | Search results always navigate to the module list, not the specific record. | `app/api/search/route.ts` |

### 4.3 Competitive gap matrix

Legend: ● strong, ◐ partial, ○ missing.

| Capability | This app (before) | Winman | Jamku | ERPCA | Zoho Practice | Karbon/TaxDome |
|---|---|---|---|---|---|---|
| Compliance calendar | ● | ◐ | ● | ● | ● | ◐ (no India dates) |
| Recurring task generation | ○ | ○ | ● | ● | ● | ● |
| Client master | ● | ● | ● | ● | ● | ● |
| Client 360 view | ○ | ○ | ◐ | ● | ● | ● |
| Document requests | ◐ | ○ | ◐ | ● | ● | ● |
| Document uploads/portal | ○ | ○ | ◐ | ● | ● (Premium) | ● |
| Recorded reminders (WhatsApp/email) | ○ | ○ | ◐ | ● | ● | ● |
| Proposal → client conversion | ○ | ○ | ○ | ◐ | ◐ | ◐ |
| GST invoice document | ○ | ◐ | ◐ | ● | ● (Books) | ○ |
| Payment recording/partials | ○ | ◐ | ◐ | ● | ● | ● |
| Ageing/realization reports | ○ | ◐ | ● | ● | ◐ | ● |
| Utilization/WIP | ◐ (raw timesheets) | ○ | ● | ● | ● | ● |
| UDIN/DSC registers | ◐ (invalid UDIN) | ○ | ● | ◐ | ○ | ○ |
| Audit trail | ● | ◐ | ◐ | ● | ● | ● |
| Roles/permissions | ○ | ◐ | ● | ● | ● | ● |
| Local-first / no per-seat | ● | ● | ○ | ○ | ○ | ○ |
| CSV export | ○ | ◐ | ● | ● | ● | ● |
| Mobile-friendly UI | ● | ◐ | ● | ● | ● | ● |

---

## 5. What this release implements

A focused operational release, chosen because it closes the highest-severity findings and the biggest competitive gaps without adding provider dependencies:

1. **Recorded reminders** — a `messages` communication log plus a reminder composer that logs each send and opens WhatsApp/email pre-filled. Replaces fake toasts in compliance, documents and invoices.
2. **Client 360** — one panel per client with services, balances, open compliance, pending documents, proposals, recent messages; edit and guarded delete; one-click reminder.
3. **GST invoice document + payments** — printable invoice with firm/client GSTIN, SAC, CGST/SGST split; record full/partial payments with mode and reference; derived status; payment history.
4. **Document uploads** — attach and download files on document requests; status advances to Received; safe storage under `.data/uploads`.
5. **Recurring compliance generation** — create GSTR-1/GSTR-3B/TDS/ITR/ROC tasks for many clients in one action with duplicate protection.
6. **Reports** — receivables ageing, collections and realization, staff utilization, compliance health, client profitability, lead conversion; CSV export of clients, invoices, compliance, timesheets and payments.
7. **Proposal → client conversion** — accepted proposals become client records with the engagement scope, and the lead is closed.
8. **Correctness fixes** — real UDIN capture and uniqueness, collision-proof IDs, invoice detail GET.

Explicitly deferred, with rationale:

- **Auth and roles** — needs a session model and an onboarding decision (local admin vs SSO); shipping it half-done would be worse than the open local build. It is the first item of the next release.
- **Client portal and e-signature** — meaningful only with auth and file retention rules.
- **Automated WhatsApp/email** — requires a provider account, opt-in handling and Meta template approval; the app now records intent and supports one-click sending honestly.
- **Payment gateway** — UPI/ Razorpay integration needs merchant credentials; payment recording is in place.
- **e-Invoicing/IRP, MCA/IT portal sync** — government integrations are a separate compliance project with credential and liability implications.

## 6. AI and data-protection release (October 2026)

### 6.1 What the competition actually ships

Verified from vendor pages and release notes in October 2026 — shipped features only, not "coming soon" marketing:

| Product | Shipped AI | Price / availability | Training on customer data |
|---|---|---|---|
| **Karbon AI** | Client and email-thread summaries, drafting in firm voice, quick replies, assignment suggestions | Included for all customers (since March 2026) | Contractually no training; OpenAI/Azure representations; regional processing |
| **TaxDome AI** | Upload renaming/tagging/categorization, checklist matching; "Juno" return drafting (availability unclear) | Document AI on all plans | States no external storage, no training of public/third-party models; SOC 2 |
| **Canopy** | Document classification, notetaker, extraction, "Coworker" NL queries and forecasts | Coworker and Notetaker in **beta**; automation credit-priced from $34/client/yr | No training unless opted in |
| **Zoho** | Ask Zia (Books), anomaly checks, AI categorization, email drafting | Included across Zoho ecosystem | Zia privacy principles: no training; **Practice itself has no native AI** |
| **Financial Cents** | File validator/renamer/router, email drafting, workflow templates, MCP | File agents on every plan; MCP on Scale | No training; OpenAI subprocessor disclosed |
| **Suvit / TaxOne** | Bank statement/invoice extraction to Tally, GST recon | ₹10,000/yr; practice-management marked "coming soon" | Policy silent on model training |
| **Jamku / ERPCA** | No substantiated AI (ERPCA lists an "ITR Co-Pilot" without detail) | — | — |

Two conclusions drive this release:

1. **AI is table stakes in 2026**, but the Indian suites are weakest: TaxOne is document automation, Jamku/ERPCA have nothing substantiated, Zoho's AI lives in Books rather than Practice. A CA firm comparing products will see AI in every global demo and almost none in Indian practice tools.
2. **Nobody pairs AI with a defensible local-first privacy story.** Global tools are cloud-only with US processing; the Indian tools that do AI route documents through their cloud with opacity about training.

The wedge: AI that *works with no cloud account at all* (deterministic, always-correct practice analytics), upgrades to a free-tier LLM of the firm's choosing, and never sends documents or statutory identifiers. That is a claim none of the above can make.

### 6.2 What ships in this release

| Capability | How it works | Keyless fallback |
|---|---|---|
| **Practice copilot** | Chat over live compliance, billing, documents, pipeline | Deterministic intent engine with the same live numbers |
| **Practice brief** | 3–4 sentence morning brief on the dashboard | Computed from live rows; AI only rewrites prose, never numbers |
| **Chase drafting** | Rewrites WhatsApp/email reminders in the reminder modal | Returns the reviewed seed message |
| **Document classification** | Suggests category + filesystem-safe filename on document requests | Keyword rule engine (GST/TDS/ITR/bank/ROC/KYC…) |
| **Insight engine** | Six ranked insights with action links: receivables concentration, overdue clusters, stalled documents, collection risk, utilization, DSC/notice deadlines, pipeline | Fully deterministic — runs with zero network |
| **Provider control** | `ai_enabled` kill-switch, provider/model badge everywhere AI output appears | — |
| **Redaction** | PAN/GSTIN patterns stripped server-side from every prompt; documents never included | — |

Provider order: Gemini → Groq → OpenRouter → NVIDIA (all free-tier capable), chosen by which key exists; `AI_PROVIDER`-style explicit selection is unnecessary because keys are the switch.

### 6.2.1 The agent layer (research-backed design)

Vendor and practitioner research (Karbon AI, TaxDome AI, Canopy Coworker, Zoho, plus OWASP LLM Top 10 and the providers' own tool-calling docs) converges on one pattern: **inline assistance inside the workflow beats a standalone chatbot, and the model must never hold authority.** Karbon and Canopy surface drafting where the work happens; TaxDome restricts AI to document handling rather than decisions; none of them let a model write to the practice without a human in the loop. This layer implements that conclusion directly:

| Design decision | Rationale | Implementation |
|---|---|---|
| Narrow, backend-owned tool set (13 tools) | Open-ended function surfaces are how prompt injection turns into data loss. Tools cover reads the practice already exposes plus exactly three writes. | `lib/ai-tools.ts` — every tool declares roles, a JSON-Schema validator, and a preview string used as the approval title |
| Bounded loop (4 rounds / 8 calls) | Unbounded tool loops burn budget and drift. | `lib/ai-agent.ts` `MAX_ROUNDS` / `MAX_CALLS` |
| Writes are proposals, never executions | Human-in-the-loop is the accepted control for consequential actions; the model's output is untrusted input. | first write → pending `ai_action`; approval re-runs ownership, role, schema and domain validation before executing |
| Role scoping on tools | Least privilege: an article assistant cannot reach a write tool at all, in either execution path. | `toolsForRole(role)` filters both the provider schemas and the keyless router |
| Treat tool output as untrusted | Client names, notes and filenames arrive from outside and may carry injected instructions. | system prompt rule; tool results are data, never commands; identifiers stripped |
| Per-user daily quota + full audit | Cost control and accountability; also the evidence trail for an incident review. | `ai_calls` (tools, rounds, latency, status) and `ai_actions` (proposed/approved/rejected/executed) |
| Keyless deterministic path | A practice tool must not stop working when a free-tier key lapses or a provider is down. | intent router + five per-task deterministic assists over the *same* tool registry |

Streaming was evaluated and skipped: answers are ≤180 words over local data that resolves in tens of milliseconds, so the added plumbing buys nothing a spinner does not already provide.

### 6.3 Security architecture (verified live)

| Control | Implementation | Verified result |
|---|---|---|
| Password storage | scrypt, 64-byte digest, per-user 16-byte salt, timing-safe compare | login works, wrong password 401 |
| Session cookies | HMAC-SHA256 signed, httpOnly, SameSite=Lax, 12h expiry, `Secure` when served over HTTPS | cookie flags present on Set-Cookie |
| Server-side revocation | per-user `token_version`; logout and password change bump it | replaying a pre-logout cookie → 401; pre-change password → 401 |
| Role enforcement | single policy (`canAccess`) applied in `proxy.ts` to every request | article write → 403; manager settings/users → 403; partner → 200 |
| CSRF | Origin must match Host on every mutation | `Origin: https://evil.example` → 403 |
| Login brute force | 10 attempts / 15 min per IP+username | 11th attempt → 429 |
| Encryption at rest | AES-256-GCM on client PAN/GSTIN, key in `.data/field.key` (0600) | DB shows `enc:v1:…`; API returns plaintext only to authorised callers |
| Headers | CSP, frame denial, nosniff, referrer, permissions, COOP, HSTS (prod) | all present on responses |
| Audit | logins, failures, logouts, password changes, all mutations | visible in dashboard audit feed |

**DPDP / CERT-In alignment.** Data minimisation (aggregate-only AI context, identifier redaction); purpose limitation (features exist only to run the practice, no marketing reuse); access/portability (CSV exports per register); correction (client edit); erasure (guarded cascading delete); accountability (immutable audit trail); security safeguards (encryption, RBAC, rate limits, headers); breach readiness (audit trail supports the CERT-In 6-hour and DPDP 72-hour reporting duties, which remain the firm's organisational obligation). India's substantive DPDP duties commence 13 May 2027, so this is ahead of the deadline rather than merely compliant today.

### 6.4 Honest limits

- **Single-tenant local instance.** No multi-firm tenancy, so no tenant-isolation claim; the model is one firm per deployment.
- **No MFA yet.** Password plus rate limiting only; TOTP is the next security milestone.
- **No centralised log shipping.** Audit lives in SQLite; CERT-In's 180-day retention is satisfied only while the database is backed up.
- **AI quality depends on the provider chosen.** Keyless mode is deterministic and cannot hallucinate, but it is also not generative.
- **Not independently audited.** No SOC 2/ISO 27001 certification is claimed.

## 7. Verification (17 October 2026)

Run against the final state of this release:

- `npx tsc --noEmit` — **0 errors**.
- `npx next build` — **success**; 15 pages plus every API route handler compiled, all routes dynamic.
- Live server (`next dev`, port 3000): **all 14 module routes return 200** (`/`, `/clients`, `/invoices`, `/reports`, `/compliance`, `/documents`, `/udin`, `/proposals`, `/leads`, `/timesheets`, `/notices`, `/campaigns`, `/dsc`, `/settings`).
- API reads return 200: `/api/health`, `/api/clients`, `/api/invoices`, `/api/payments`, `/api/reports`, `/api/messages`, `/api/search?q=tax`, `/api/export?type=leads`.
- Validation returns 400 as expected: malformed UDIN, empty payment body, empty client name.
- CSV export verified for all 7 registers (clients, invoices, payments, compliance, documents, timesheets, leads) — correct headers, UTF-8 content.
- Global search returns grouped results with deep links (e.g. `/clients?client=CLIENT-001`).
- Browser verification: `/reports` renders ageing buckets, billed-vs-collected, staff utilization, compliance health, client profitability and lead conversion from live data; `/clients` renders the directory plus the 360° dialog (Remind / Edit / Delete, balances, KYC, open compliance, documents, invoices, logged communication). **Zero console errors** on both pages. (Pixel screenshots were unavailable because the preview webview was not compositing; verification used the accessibility tree instead.)

### 7.1 AI layer verification (17 October 2026)

All exercised against the running server with **no provider key configured** — i.e. the deterministic path every deployment gets by default.

| Check | Result |
|---|---|
| Unauthenticated `POST /api/ai/agent` | **401** |
| Read intents (plan, receivables, pending docs, client summary) | Correct multi-tool answers with the tool trace shown (`practice_overview`, `list_overdue_invoices`, `revenue_summary`, `client_360`, …) |
| Client extraction from free text ("bank statement **for Sep 2026 from** Mehta & Sons LLP") | Resolved to the right client after replacing preposition-based parsing with longest-known-name matching; title casing preserved (`"TDS challans for Q3"`) |
| Propose → approve (document request) | `AIACT-001` executed; document row created; **14 → 15** documents; audit rows `AI_ACTION_PROPOSED` + `DOCUMENT_REQUESTED` present |
| Cross-user approval | Manager approving the partner's action → **404 Action not found** (ownership enforced) |
| Repeat approval of an executed action | **409 Action already executed** (idempotent — no second write) |
| Reject path (compliance task proposal) | Rejected; compliance count unchanged (**20 → 20**) — nothing written |
| Article role asking for a write | "Your role is read-only…" with **no proposal created** |
| Daily quota | `calls_today` increments per request and is surfaced in the palette (`15/80`); `AI_DAILY_LIMIT` enforced with 429 |
| `/api/ai/usage` | Returns quota, pending actions, provider disclosure and the last 8 calls with their tool names |
| Five module assists | Each answers its own question: `client_summary` (5-bullet brief), `week_plan` (ranked deadlines), `collection_plan` (per-invoice tone), `utilization_review` (staffing action), `notice_draft` (5-part reply outline) |
| ⌘J palette in browser | Opens on any page, suggestion chips per route, tool chips under every reply, proposal card with Approve/Reject; after approving, the card flips to **APPROVED** with `Document request DOC-017 created…`; quota counter updates |
| Inline assists in browser | Client 360 → "relationship brief" sheet showing the client's own balances, filings, documents and next action |
| Console / server log | **Zero errors**, zero unhandled rejections across every flow above |
| Provider tool-calling loop | Exercised end-to-end against local mock gateways (`*_BASE_URL` overrides): OpenAI-compatible branch ran 2 rounds (read executed inline → model-produced write became pending `AIACT-006`, approved to `DOC-018`); Gemini branch parsed `functionCall`/`functionResponse` parts with a 13-declaration schema and `additionalProperties` stripped; provider + model surfaced in `/api/ai/usage`. **Asserted**: outbound payloads contained 0 raw PAN/GSTIN and 2+2 `[PAN-REDACTED]`/`[GSTIN-REDACTED]` tokens. Provider down → HTTP 200 with deterministic fallback, not an error |

Defects found and fixed during verification: (1) client extraction took the wrong span of free text, so "request … from Client" failed to resolve; (2) document names were lowercased because the router matched on a lowercased copy of the message; (3) the assist route answered every task with the generic document-pending reply instead of its own brief; (4) the proposal card header stayed at "Needs approval" after a decision.

## 8. Roadmap

**Now (this release):** reminders log, client 360, GST invoice + payments, uploads, recurring tasks, reports, CSV, proposal conversion, UDIN/ID fixes, AI copilot layer, encrypted identifiers, password auth with roles, session revocation, hardened headers and CSRF/rate-limit defences.

**Next (release 2):** client portal with tokenised upload links, email templates with SMTP, WhatsApp Business Cloud API opt-in/template flow, payment link (UPI/Razorpay), engagement letters with signature capture, notification centre, MFA (TOTP) for partner accounts.

**Later (release 3):** e-invoice/IRP and MCA/IT portal status sync, document OCR and auto-classification, client profitability budgeting, mobile PWA/offline capture, bank reconciliation imports, API/webhooks for Tally/Zoho Books, DPDPA retention controls and encrypted backups.

## 9. Success metrics

- Time to collect a document set (days from request to verified).
- % of filings completed before due date; overdue count.
- Days sales outstanding and % of fees collected within 30/60/90 days.
- Billable utilization and realization rate by staff and client.
- Weekly active staff and clients touched per staff member.
- Zero "sent" records without a delivery channel and timestamp.

## 10. Sources

Competitor and market evidence: [Winman product](https://www.winmansoftware.com/products/ca-erp/), [Winman reviews](https://www.softwaresuggest.com/winman-ca-erp/reviews), [Jamku pricing](https://madrecha.com/jamku/pricing/), [ERPCA pricing](https://www.erpca.com/pricing/), [Zoho Practice pricing](https://www.zoho.com/practice/pricing/), [Zoho tasks](https://www.zoho.com/practice/help/tasks/tasks-preferences.html), [Karbon pricing](https://karbonhq.com/pricing), [Karbon analytics](https://karbonhq.com/feature/analytics/), [Karbon review](https://www.trustradius.com/products/karbon/reviews), [TaxDome pricing](https://help.taxdome.com/article/1800-taxdome-pricing-plans-us-ca), [TaxDome testimonials](https://taxdome.com/testimonials), [Canopy pricing](https://www.getcanopy.com/pricing/), [Financial Cents pricing](https://financial-cents.com/pricing/), [Jetpack pricing](https://jetpackworkflow.com/pricing/), [Vyapar TaxOne pricing](https://taxone.vyapar.com/pricing), [ClearTax TaxCloud](https://cleartax.in/taxcloud), [ICAI PMS](https://bs.icai.org/pms-2/).

India requirements: [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html), [ICAI UDIN timing](https://www.icai.org/post/aligning-the-time-limit-of-generating-udin-from-15days-to-60days), [Income-tax e-verify](https://www.incometax.gov.in/iec/foportal/help/how-to-e-verify-your-e-filing-return), [Zoho Books e-invoicing](https://www.zoho.com/in/books/help/e-invoicing/), [Meta WhatsApp opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-opt-in), [Meta WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).

Pain points and operations: [CAclubindia month-end](https://www.caclubindia.com/forum/consultation-616131.asp), [document collection](https://www.caclubindia.com/forum/building-a-tool-to-simplify-client-document-collection-for-ca-firms-8212-would-love-your-feedback-615110.asp), [fee recovery](https://www.caclubindia.com/forum/how-to-lock-the-account--601245.asp), [DPDPA client data](https://www.caclubindia.com/forum/client-consent-under-dpdpa-is-client-sharing-pan-aadhaar-and-form-16-enough--615528.asp), [IFAC KPIs](https://www.ifac.org/knowledge-gateway/discussion/monitoring-and-benchmarking-key-performance-indicators-part-one), [IFAC credit control](https://www.ifac.org/knowledge-gateway/discussion/enhancing-firm-credit-control-and-fee-collection), [I4C ransomware advisory](https://taxguru.in/corporate-law/advisory-ransomware-groups-targeting-nas-devices-ca-consulting-firms.html).
