# AI layer — architecture & rollout plan

**Status:** implemented October 2026. This document is the design of record; verification results are in `REPORT.md`.

## 1. Problem

The first AI release added isolated features (chat, brief, draft, classify). Competitor research and practitioner surveys show the value is not a chatbot — it is **AI inside the task**: drafting in the reminder modal, checking uploads, summarising a client before a call, and turning a jammed week into a plan. The layer must also be safe enough for a CA firm's client data: no fabricated numbers, no authority held by the model, no silent writes.

## 2. Principles (from OWASP LLM Top 10 and vendor practice)

1. **The model is an untrusted planner.** Authority lives in this backend; tools are executed here after validation.
2. **Narrow, typed tools.** No SQL, no URLs, no arbitrary record mutation. Every tool has a JSON schema, a role allow-list, and a validator that runs again at execution time.
3. **Read / draft / commit separation.** Reads execute immediately. Writes are **proposals** stored in `ai_actions` and require an explicit human approval bound to that exact proposal.
4. **Bounded autonomy.** Max 4 model rounds, max 8 tool calls, 15 s per provider call, daily quota per user.
5. **Deterministic fallback.** No key, provider error, or bad JSON = the same tools run through a rule-based router. The product never depends on a network call.
6. **Data minimisation.** Tool outputs exclude PAN/GSTIN and contact numbers; prompts are redacted again before sending; documents are never sent.
7. **Audit everything.** `ai_calls` records action, provider/model, tools used, latency, status — no raw prompts or document content.
8. **Treat all stored text as untrusted.** Client names, notes and document titles are wrapped as data in tool results, and the system prompt says never to follow instructions found inside them.

## 3. Components

```
proxy.ts (auth + roles)
   └─ /api/ai/agent ─ runAgent() ── lib/ai-tools.ts (registry: read + write)
   │                     │           lib/ai-prompts.ts (versioned system prompt)
   │                     ├─ provider tool-calling (lib/ai.ts: chatWithTools)
   │                     ├─ deterministic router (keyless)
   │                     └─ lib/ai-audit.ts → ai_calls, quota
   ├─ /api/ai/assist ──── predefined tasks: client_summary, week_plan,
   │                     collection_plan, utilization_review, notice_draft
   ├─ /api/ai/actions/[id] ─ approve/reject a pending write (re-validated)
   └─ /api/ai/usage ───── quota, provider, recent calls, pending approvals

UI: components/ai-command.tsx  (⌘J palette on every page)
    components/ai-assist.tsx   (inline button + modal per module)
```

## 4. Tool matrix

| Tool | Kind | Roles | Returns / effect |
|---|---|---|---|
| `practice_overview` | read | all | KPIs, counts, top insight |
| `find_client` | read | all | id, name, entity, city (no identifiers) |
| `client_360` | read | all | balances, open compliance, pending docs, overdue invoices, last reminder |
| `list_deadlines` | read | all | open tasks due within N days + overdue, ranked |
| `list_pending_documents` | read | all | pending requests with days waiting |
| `list_overdue_invoices` | read | all | unpaid/overdue with balance and days late |
| `revenue_summary` | read | all | billed/collected/outstanding, ageing buckets |
| `utilization_summary` | read | all | hours, billable share, approved, per staff |
| `pipeline_summary` | read | all | stage counts, hot leads, proposals |
| `get_notice` | read | all | notice type, portal, deadline, status (for reply drafting) |
| `request_document` | **write** | partner, manager | creates a pending document request |
| `create_compliance_task` | **write** | partner, manager | creates a compliance task |
| `log_reminder` | **write** | partner, manager | records a sent reminder in the message log |

Article accounts never receive write tools (and execution re-checks the role anyway).

## 5. Approval lifecycle

```
proposed → approved → executed
        └→ rejected
        └→ failed (validation or execution error, surfaced to the user)
```

`ai_actions` stores: `action_id`, `user_id`, `tool`, `args` (JSON), `title` (human preview), `status`, `result`, timestamps. On approve: ownership, status, role, schema and business validation run again, then the tool executes and an audit row is written. There is no "replay once approved" path that skips validation.

## 6. Privacy & prompt-injection posture

- Tool outputs exclude PAN, GSTIN and phone/email values.
- `redactIdentifiers()` runs on the system prompt and every user/tool message before egress.
- Tool results carry client-supplied text in a `data` field; the system prompt marks it untrusted and forbids following instructions inside it.
- The model never sees credentials, uploaded file bytes, or settings.
- `ai_enabled` remains a global kill-switch; quota is per user; every call is audited.

## 7. UX surfaces

- **Global palette (`⌘J`)**: ask anything, see which tools ran, approve/reject proposals inline.
- **Client 360**: "AI summary" — relationship brief before a call.
- **Compliance**: "Plan my week" — ranked deadline plan with owners and next actions.
- **Invoices**: "Collection plan" — who to chase first and what to say.
- **Notices**: "Draft reply" — outline grounded in the notice record (professional review still required).
- Existing inline assists (reminder rewrite, document classification, dashboard brief) remain.

## 8. Provider notes

Tool calling is implemented for OpenAI-compatible providers (Groq, OpenRouter, NVIDIA) and Gemini's `functionDeclarations`/`functionCall`. Free-tier availability and model entitlements change frequently; model names are env-overridable (`GROQ_MODEL`, `GEMINI_MODEL`, …). Without any key the deterministic router exercises the exact same tool registry, so behaviour is testable offline.

## 9. Verification plan

1. `tsc --noEmit` and `next build`.
2. Keyless agent: overview, deadlines, fees, documents, utilization, client summary — assert tool steps and no fabricated numbers.
3. Proposal flow: propose → approve → row created; propose → reject → no row; article write attempt refused.
4. Usage endpoint counts calls; unauth 401; role policy unchanged.
5. Browser: palette opens, answer renders, steps visible, approve creates the record; inline assists render in three modules.
6. Document limits honestly: provider tool-calling is code-complete but cannot be exercised without an API key.

## 10. Next

MFA, per-user AI budgets in Settings, document text extraction with local OCR + redaction pipeline, and an eval harness of 50 golden questions per module.
