/**
 * Durable, retryable scheduled generation.
 *
 * A cron invocation only enqueues the logical daily run (the jobs.logical_key
 * unique index makes that idempotent). The worker then executes due jobs and
 * records the outcome in engagement_generation_runs. A crashed worker leaves a
 * `running` job that claimDueJobs recovers after ten minutes.
 */
import { enqueueJob, claimDueJobs, completeJob, failJob, type Job } from "./jobs";
import { generateCurrentPeriod, type GenerateResult } from "./engagement-engine";
import { todayISO } from "./format";

export const RECURRENCE_JOB_KIND = "recurrence.generate";

export function enqueueRecurrence(actor: string): { job: Job; created: boolean } {
  return enqueueJob({
    kind: RECURRENCE_JOB_KIND,
    logicalKey: `recurrence:${todayISO()}`,
    payload: { actor, window: todayISO() },
    maxAttempts: 3,
  });
}

export function runRecurrenceJob(job: Job): GenerateResult {
  const payload = safePayload(job.payload);
  const actor = typeof payload.actor === "string" && payload.actor ? payload.actor : "Scheduled recurrence engine";
  return generateCurrentPeriod(actor);
}

export type RecurrenceSweepResult = {
  queued: boolean;
  job_id: string;
  processed: number;
  completed: number;
  failed: number;
  runs: Array<{ job_id: string; created: number; skipped: number; failed: number; status: string }>;
  errors: string[];
};

/** Processes only recurrence jobs; other queued job kinds are left untouched. */
export function processRecurrenceQueue(limit = 5): RecurrenceSweepResult {
  const jobs = claimDueJobs(limit, RECURRENCE_JOB_KIND);
  const runs: RecurrenceSweepResult["runs"] = [];
  const errors: string[] = [];
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const run = runRecurrenceJob(job);
      completeJob(job.job_id);
      completed++;
      runs.push({
        job_id: job.job_id,
        created: run.run.created,
        skipped: run.run.skipped,
        failed: run.run.failed,
        status: run.run.status,
      });
    } catch (err) {
      failed++;
      const message = (err as Error).message || "Recurrence generation failed";
      failJob(job.job_id, message);
      errors.push(`${job.job_id}: ${message}`);
    }
  }
  return { queued: false, job_id: "", processed: jobs.length, completed, failed, runs, errors };
}

export function scheduleAndProcessRecurrence(actor: string): RecurrenceSweepResult {
  const enqueued = enqueueRecurrence(actor);
  const result = processRecurrenceQueue(10);
  return { ...result, queued: enqueued.created, job_id: enqueued.job.job_id };
}

function safePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
