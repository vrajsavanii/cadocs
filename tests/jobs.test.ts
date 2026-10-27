import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { withIsolatedDataDir, simulateRestart } from "./helpers/setup";

withIsolatedDataDir();

const { enqueueJob, claimDueJobs, completeJob, failJob, jobStats } = await import("../lib/jobs");

describe("durable job queue", () => {
  it("is idempotent per logical key: re-enqueueing the same logical event is a no-op", () => {
    const first = enqueueJob({ kind: "test.reminder", logicalKey: "remind:CLIENT-T01:DOC-T9", payload: { doc: "DOC-T9" } });
    const second = enqueueJob({ kind: "test.reminder", logicalKey: "remind:CLIENT-T01:DOC-T9" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.job_id).toBe(first.job.job_id);
  });

  it("claims only due jobs and tracks attempts", () => {
    enqueueJob({ kind: "test.due", logicalKey: "job-due-1" });
    const claimed = claimDueJobs(10).filter((j) => j.kind === "test.due");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe("running");
    expect(claimed[0]!.attempts).toBe(1);
    // A locked job cannot be claimed by another worker.
    expect(claimDueJobs(10).filter((j) => j.kind === "test.due")).toHaveLength(0);
  });

  it("moves a job to a terminal success state only via completeJob", () => {
    enqueueJob({ kind: "test.complete", logicalKey: "job-complete-1" });
    const [job] = claimDueJobs(10).filter((j) => j.kind === "test.complete");
    completeJob(job!.job_id);
    const stats = jobStats();
    expect(stats.completed).toBeGreaterThanOrEqual(1);
  });

  it("retries on failure with backoff and parks terminal failures as dead", () => {
    enqueueJob({ kind: "test.retry", logicalKey: "job-retry-1", maxAttempts: 2 });
    const [job] = claimDueJobs(10).filter((j) => j.kind === "test.retry");

    const afterFail = failJob(job!.job_id, "first transient error");
    expect(afterFail!.status).toBe("pending");
    expect(afterFail!.attempts).toBe(1);
    expect(afterFail!.last_error).toBe("first transient error");
    expect(new Date(afterFail!.run_at).getTime()).toBeGreaterThan(Date.now() + 60_000); // backoff scheduled

    // Force due again and reclaim.
    (globalThis as unknown as { __caDb?: DatabaseSync }).__caDb!.prepare("UPDATE jobs SET run_at = ? WHERE logical_key = 'job-retry-1'").run(new Date().toISOString());
    const [again] = claimDueJobs(10).filter((j) => j.kind === "test.retry");
    failJob(again!.job_id, "second — terminal");
    const dead = (globalThis as unknown as { __caDb?: DatabaseSync }).__caDb!.prepare("SELECT status, last_error FROM jobs WHERE logical_key='job-retry-1'").get() as {
      status: string;
      last_error: string;
    };
    expect(dead.status).toBe("dead");
    expect(dead.last_error).toBe("second — terminal");
    expect(jobStats().dead).toBeGreaterThanOrEqual(1);
  });

  it("recovers stale running jobs after a simulated restart", () => {
    enqueueJob({ kind: "test.stale", logicalKey: "job-stale-1" });
    claimDueJobs(10); // leaves it 'running'
    // Simulate: the worker died 20 minutes ago mid-flight.
    (globalThis as unknown as { __caDb?: DatabaseSync }).__caDb!
      .prepare("UPDATE jobs SET updated_at = ?, status = 'running' WHERE logical_key = 'job-stale-1'")
      .run(new Date(Date.now() - 20 * 60_000).toISOString());

    simulateRestart();
    const recovered = claimDueJobs(10).filter((j) => j.kind === "test.stale");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.status).toBe("running"); // re-claimed, attempts counted
    expect(recovered[0]!.attempts).toBe(2);
  });
});
