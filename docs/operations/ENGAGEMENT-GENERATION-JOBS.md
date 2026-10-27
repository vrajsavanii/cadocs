# Engagement Generation Jobs

**Status:** implemented (Prompt 5). Cron endpoint
[app/api/cron/recurrence/route.ts](../../app/api/cron/recurrence/route.ts), queue
mechanics in [lib/jobs.ts](../../lib/jobs.ts), executor in
[lib/engagement-jobs.ts](../../lib/engagement-jobs.ts).

## How a daily run happens

```
Vercel Cron (04:00 UTC, vercel.json)
   │  Authorization: Bearer $CRON_SECRET   (or x-vercel-cron / vercel-cron UA)
   ▼
GET /api/cron/recurrence
   │  authorize() → 401 without the secret
   ▼
scheduleAndProcessRecurrence(actor)
   ├─ enqueueRecurrence()  → jobs(kind='recurrence.generate',
   │                          logical_key='recurrence:<today>')   ← idempotent
   └─ processRecurrenceQueue() → claimDueJobs() → runRecurrenceJob()
                                     │
                                     ▼
                          generateCurrentPeriod(actor)   ← same engine as the UI
                                     │
                                     ▼
                     engagement_generation_runs row + per-item plan detail
```

`logical_key` is unique in the database: a cron that fires twice, or an operator who
presses "Run" while the cron is in flight, enqueues nothing the second time.

## Edge policy note (important)

`proxy.ts` requires a session for every non-public path. Prompt 5 added
`/api/cron/*` to `isPublicPath` in [lib/auth.ts](../../lib/auth.ts) so a cron request
(which carries no session cookie) can reach its handler; the handler then authorises
itself with `CRON_SECRET`. **Both** cron routes (`/api/cron/automation` and
`/api/cron/recurrence`) depend on this — without it every background job would die at
the edge with a 401 "Sign in required". Covered by `tests/auth-policy.test.ts`.

## Authentication

1. `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>` — preferred.
2. Vercel's own markers: `x-vercel-cron` header or a `vercel-cron*` user agent.
3. Anything else → `401 {"error":"Unauthorized — set CRON_SECRET …"}`.

Set `CRON_SECRET` in the deployment environment. With the secret unset, only Vercel
cron markers are accepted — a plain browser request is refused.

## Retry and failure semantics

- `enqueueJob` default `max_attempts = 3`; each failure reschedules with linear
  backoff (`attempts × 2 minutes`) via `failJob`, then parks the job as `dead` with
  `last_error` for operator review.
- `claimDueJobs` resets `running` jobs older than 10 minutes back to `pending`, so a
  crash mid-run is recovered automatically on the next sweep.
- `completeJob` is the only path to a terminal success state; enqueueing alone never
  counts as work done.
- A generation run never partially commits a single engagement: each engagement insert
  is an individual guarded statement, and a run that throws is recorded as
  `status='failed'` with its error — existing rows and their stage/filing progress are
  untouched (verified: re-running generation preserves progress).

## Observability

- `engagement_generation_runs` — every preview/commit/cron run with counts
  (`processed`, `created`, `skipped`, `failed`, `warnings`) and the full itemised
  plan JSON in `detail`. Readable via `GET /api/engagements/runs` and the
  generation panel in `/compliance`.
- `jobs` — `jobStats()` feeds the health surface (pending/running/dead/completed).
- `audit_log` — due-rule verification, overrides and assignment changes.

## Manual invocation

```bash
# with a secret
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/recurrence
# expected response
{"ok":true,"queued":true,"job_id":"JOB-001","processed":1,"completed":1,"failed":0,
 "runs":[{"job_id":"JOB-001","created":3,"skipped":34,"failed":0,"status":"completed"}],"errors":[]}
# second call the same day
{"ok":true,"queued":false,"job_id":"JOB-001","processed":0,...}
```

The UI path (`POST /api/engagements/generate`, manager/partner, `confirmed:true`) runs
the same engine synchronously and writes its own run row with `trigger='manual'`.

## Operational checklist

1. `CRON_SECRET` set in production environment.
2. `vercel.json` contains the `/api/cron/recurrence` entry (added by Prompt 5).
3. After a deploy, confirm `GET /api/engagements/runs` shows a completed run.
4. If `jobs` shows `dead > 0`, read `last_error`, fix the cause, and reset or re-run
   from the generation panel.
5. Never run generation directly against production data with a hand-written script —
   use the preview/commit API so the run is recorded and idempotent.

## Known limitations

- One logical run per calendar day (key = date). Catch-up after a multi-day outage
  generates only the *current* completed period, by design — historical periods are
  never back-filled silently.
- Jobs are per-installation (single-firm); there is no tenant dimension in the queue.