/**
 * Durable job queue on the SQLite spine.
 *
 * Scheduled/deferred work (reminder sends, generation runs, future WhatsApp
 * deliveries) is persisted in the `jobs` table — created by migration 2 — so
 * intended work survives cold starts and application restarts. A logical_key
 * makes enqueueing idempotent: the same logical event cannot be queued twice
 * no matter how many callers race (unique index, enforced by the database).
 *
 * This is the queue mechanics; the executors that consume it arrive with the
 * WhatsApp/automation phases (see IMPLEMENTATION-ROADMAP Prompt 08). Nothing
 * here treats a *created* job as successful — only completeJob moves it to a
 * terminal success state, and terminal failures land in `dead` for review.
 */
import { all, getDb, nextId, one, withTransaction } from "./db";

export type JobStatus = "pending" | "running" | "completed" | "dead";

export interface Job {
  job_id: string;
  kind: string;
  logical_key: string | null;
  run_at: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  payload: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueueJob(input: {
  kind: string;
  logicalKey?: string | null;
  runAt?: Date | string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}): { job: Job; created: boolean } {
  const runAt = input.runAt ? new Date(input.runAt) : new Date();
  const logicalKey = input.logicalKey?.trim() || null;
  return withTransaction(() => {
    if (logicalKey) {
      const existing = one<Job>("SELECT * FROM jobs WHERE logical_key = ?", logicalKey);
      if (existing) return { job: existing, created: false };
    }
    const job: Job = {
      job_id: nextId("JOB", "jobs", "job_id"),
      kind: input.kind,
      logical_key: logicalKey,
      run_at: runAt.toISOString(),
      status: "pending",
      attempts: 0,
      max_attempts: Math.max(1, input.maxAttempts ?? 3),
      payload: JSON.stringify(input.payload ?? {}),
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    getDb()
      .prepare(`INSERT INTO jobs (job_id,kind,logical_key,run_at,status,attempts,max_attempts,payload,last_error,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(job.job_id, job.kind, job.logical_key, job.run_at, job.status, job.attempts, job.max_attempts, job.payload, job.last_error, job.created_at, job.updated_at);
    return { job, created: true };
  });
}

/**
 * Atomically claims due pending jobs for a worker, up to `limit`.
 * Stale `running` jobs (worker died mid-flight, older than 10 minutes) are
 * reset to pending first, so pending work is recovered after a restart.
 */
export function claimDueJobs(limit = 10, kind?: string): Job[] {
  return withTransaction(() => {
    const db = getDb();
    const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    db.prepare("UPDATE jobs SET status='pending', updated_at=? WHERE status='running' AND updated_at < ?").run(new Date().toISOString(), staleCutoff);

    const due = kind
      ? all<Job>(
          `SELECT * FROM jobs WHERE status = 'pending' AND kind = ? AND run_at <= ? ORDER BY run_at ASC LIMIT ?`,
          kind,
          new Date().toISOString(),
          Math.min(Math.max(limit, 1), 100),
        )
      : all<Job>(
          `SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?`,
          new Date().toISOString(),
          Math.min(Math.max(limit, 1), 100),
        );
    for (const job of due) {
      db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, updated_at=? WHERE job_id=? AND status='pending'").run(
        new Date().toISOString(),
        job.job_id,
      );
      job.status = "running";
      job.attempts += 1;
    }
    return due;
  });
}

/** Marks a job completed — the only path to a terminal success state. */
export function completeJob(jobId: string): void {
  getDb()
    .prepare("UPDATE jobs SET status='completed', last_error=NULL, updated_at=? WHERE job_id=?")
    .run(new Date().toISOString(), jobId);
}

/**
 * Records a failure. Retries with linear backoff (attempts × 2 minutes) until
 * max_attempts, then parks the job in `dead` for operator review.
 */
export function failJob(jobId: string, error: string): Job | null {
  withTransaction(() => {
    const current = one<Job>("SELECT * FROM jobs WHERE job_id=?", jobId);
    if (!current) return;
    if (current.attempts >= current.max_attempts) {
      getDb()
        .prepare("UPDATE jobs SET status='dead', last_error=?, updated_at=? WHERE job_id=?")
        .run(error.slice(0, 500), new Date().toISOString(), jobId);
    } else {
      const retryAt = new Date(Date.now() + current.attempts * 2 * 60_000).toISOString();
      getDb()
        .prepare("UPDATE jobs SET status='pending', last_error=?, run_at=?, updated_at=? WHERE job_id=?")
        .run(error.slice(0, 500), retryAt, new Date().toISOString(), jobId);
    }
  });
  return one<Job>("SELECT * FROM jobs WHERE job_id=?", jobId);
}

/** Safe operational summary for the health endpoint — counts only. */
export function jobStats(): { pending: number; running: number; dead: number; completed: number } {
  const rows = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status");
  const stats = { pending: 0, running: 0, dead: 0, completed: 0 };
  for (const row of rows) {
    if (row.status === "pending") stats.pending = row.n;
    else if (row.status === "running") stats.running = row.n;
    else if (row.status === "dead") stats.dead = row.n;
    else if (row.status === "completed") stats.completed = row.n;
  }
  return stats;
}
