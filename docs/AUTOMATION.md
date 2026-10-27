# The automation layer

**Release:** v3.1 — the automation layer
**Scope:** turning the repetitive half of a CA firm's week into standing rules that run, record and escalate.

---

## 1. Why this exists

The AI release made the practice *answerable* — ask a question, get a grounded reply, approve a change. That still leaves the real burden untouched: **the same work returns every week.** Chasing the same missing bank statements. Reminding the same three clients about the same overdue invoice. Recreating GSTR-3B for forty clients on the 1st of every month. Watching which filing went overdue, which DSC is about to lapse, whose notice response window is closing.

Practitioner evidence (see `REPORT.md` §2) says the work is not the filing — it is the coordination around the filing. Coordination is repetitive by nature, which makes it the correct target for automation rather than chat.

If AI proposes an action, **automation proposes the schedule.** This release lets a partner say "chase documents after 5 days, every morning" once, and the firm gets the list, the message, the record and the follow-up without anyone remembering to do it.

---

## 2. The model: a rule is a standing approval

The AI layer's rule is *writes are proposals, never executions*. Automation cannot abandon that principle, so it reframes it:

> **The rule is approved; the instances are not re-approved.** A partner configures "remind invoices 30+ days late" and that configuration is the human decision. The sweep then executes within exactly that envelope.

Two modes, per rule:

| Mode | What the sweep does | When to use it |
|---|---|---|
| `auto` | Executes the action; writes an `automation_run` + audit entry with what it created | Low-risk, reversible, high-frequency work: queuing a chaser, creating a statutory task, recording an escalation |
| `approval` | Prepares the action as a pending `ai_action`; nothing executes until a partner approves it in the copilot | Any rule a firm wants eyes on each run |

Every action in this release defaults to `auto` **because all of them are reversible and none of them send anything** (§4). A firm that disagrees flips any rule to `approval` from the Automation page.

---

## 3. The actions

Six rule types cover the coordination work. Each is a configuration over the same typed tool registry the chat agent uses, so validation, role scoping and argument re-checks apply identically.

| Action | What it does | Backing tool |
|---|---|---|
| `chase_documents` | Groups every pending document request older than N days by client and queues **one** consolidated chaser per client | `chase_documents_bulk` |
| `dunning` | Groups unpaid invoices past N days by client, picks a tone from age (gentle / firm / final) and queues one reminder per client | `dunning_bulk` |
| `generate_compliance` | Creates the period's GSTR-1/3B/9, TDS, ITR, audit or ROC task for **every** client in one sweep, duplicate-safe | `generate_compliance_batch` |
| `escalate_overdue` | Flags filings more than N days past due to the partner, naming owners | internal (audit + digest) |
| `dsc_watch` | Warns when any DSC expires within N days, before filing rejections start | internal (audit + digest) |
| `notice_watch` | Alerts when a notice response is due within N days — and when it is already overdue | internal (audit + digest) |

### Presets — the CA playbook

`RULE_PRESETS` in `lib/automation.ts` ships the seven rules a firm should probably run from day one (chase after 5 days, dun after 30, monthly GSTR-3B due the 20th, TDS 26Q due the 7th, escalate at 3 days overdue, DSC warning at 30 days, notice watch at 3 days). They are one click each from the Automation page: presets carry the *why* so the partner is choosing a practice decision, not a toggle.

---

## 4. What automation never does

This is the part that keeps the feature honest in a practice tool:

- **It never sends a message.** Chasers and reminders are written to `messages` with status `Queued`. The Outbox shows each one with a `wa.me` / `mailto:` deep link; a human sends it and marks it sent (or dismisses it). "Sent" therefore always means sent — the same standard the manual reminder flow holds.
- **It never invents content.** Every message is built from rows: the client's own pending documents, their own invoices and balances, the firm's name from Settings. No generated amounts, no invented references.
- **It never touches a client's statutory identifiers.** PAN/GSTIN never enter the automation path (they are encrypted at rest and excluded from the AI context entirely).
- **It never runs an action the rule did not declare.** `sanitizeParams` normalises every params object — hand-written or model-produced — to the exact keys the executor understands, and clamps every numeric knob.
- **It never hides.** Every run is a row in `automation_runs` (status, summary, per-run detail with created ids, actor, timestamps) plus an `audit_log` entry.

---

## 5. Scheduling

Rules carry a cadence — `daily`, `weekly`, `monthly` — and scheduling is **elapsed-time**, not cron-string matching:

- `daily` — last run was on an earlier calendar day
- `weekly` — last run ≥ 6 days ago
- `monthly` — last run ≥ 27 days ago

Elapsed-time cadence means a missed day self-heals: if the host was asleep on Monday, Tuesday's sweep still runs the weekly rule. There is no "the cron didn't fire and the filing was missed" failure mode.

Three ways to run:

| Trigger | Path | What runs |
|---|---|---|
| Scheduled | `GET /api/cron/automation` (see `vercel.json`) | Enabled rules whose cadence has elapsed |
| Operator | **Run now** / **Preview** on the Automation page | All enabled rules (Preview is a dry run — nothing is written) |
| Targeted | **Run** / **Preview** on a single rule row | Exactly that rule, even if paused |

`/api/cron/automation` authorises with `Authorization: Bearer $CRON_SECRET` (or `?key=`), and accepts Vercel's own cron header only when no secret is configured. It has no session, so `proxy.ts` lets it through to its own check.

---

## 6. Planning a rule in natural language

`POST /api/automation/plan` turns a sentence into a rule draft.

1. **Deterministic planner** (`planRuleFromText`) recognises the phrasings a CA actually types — documents/money/escalate/DSC/notice, with day windows — and returns a validated draft. **This always runs, with no provider key.**
2. **Provider-assisted planner** (`planRuleWithAi`) is attempted only when a key is configured. It asks for JSON, then **re-validates**: unknown action → deterministic draft; unknown params → dropped by `sanitizeParams`; bad mode/cadence → defaults.

So a hostile or confused model answer cannot create a rogue automation — the worst case is that the firm gets the deterministic rule it would have got keyless.

---

## 7. Data model

```sql
automation_rules (rule_id, name, action, params JSON, mode, cadence, enabled,
                  last_run_at, run_count, created_by, created_at)

automation_runs  (run_id, rule_id, rule_name, status, summary, detail JSON,
                  actor, started_at, finished_at)
```

`detail` carries the machine-readable outcome (`actions`, `created`/`queued` counts, message ids, escalation lists, preview strings), which is what the UI renders and what `automationActivity()` sums for the "Actions · 7 days" counter.

Outbox state lives on the existing `messages` table (`status = 'Queued'`), so the client-360 timeline, the audit trail and the outbox all read from one record.

---

## 8. UI

`/automation` (partner + manager configure; article sees read-only):

- **Stat strip** — active rules, outbox waiting, actions taken in 7 days, and the size of the backlog automation can clear right now.
- **Describe an automation** — natural-language composer with a draft card (name, action, cadence, mode, explanation) and an explicit *Create rule*.
- **Standing rules** — per-rule enable switch, mode and cadence selects, Preview / Run / Delete, last-run time and run count, and a plain-English explanation of what the rule does.
- **The CA playbook** — unconfigured presets with their rationale, one click to add.
- **Outbox** — each queued message with the client, channel, first lines, an *Open WhatsApp/Email* deep link, *Sent* and *Dismiss*.
- **Run history** — every run with status, what happened and when.

The sidebar badge counts queued outbox items, so prepared work is visible from anywhere in the app.

## 9. Security and roles

- Reads are open to every signed-in role; **creating, editing, deleting and running rules is partner/manager** (enforced both in `proxy.ts`'s policy and in each route handler).
- The cron endpoint has no session; it is gated by `CRON_SECRET` and is the only automation surface outside the auth gate.
- `POST /api/automation/run` rejects unknown rule ids and honours `dry_run` strictly — the preview path writes nothing, including no run records and no `last_run_at` bumps.
- Every rule change (create/update/delete) and every run is audited with the actor.

## 10. Verification (see §7 of REPORT.md for the run sheet)

- `npx tsc --noEmit` — 0 errors.
- `npx next build` — success.
- Functional: with a temp `CA_DATA_DIR`, add the document-chase preset, run the sweep, and assert (a) one queued message per client with a real address, (b) clients without a phone are reported as skipped, (c) a second sweep on the same day is a no-op for a `daily` rule, (d) the run and audit rows exist, (e) `dry_run` writes nothing.
- Role checks: article `POST /api/automation` → 403; signed-out `GET /api/automation` → 401; cron without secret → 401.
