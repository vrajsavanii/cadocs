/**
 * Task blockers.
 *
 * A blocker is an explicit, owned reason a piece of work cannot proceed.
 * Blockers are staff-created records — the workflow already derives document
 * and assignment blocks from the underlying data; this module records the
 * human ones (client information needed, portal down, partner approval
 * pending) and gates transitions while they stay open.
 */
import type { AuthUser, BlockerCategory, TaskBlocker } from "./types";
import { isBlockerCategory } from "./types";
import { getDb, listCompliance, logAudit, nextId, one, withTransaction } from "./db";

export class BlockerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "BlockerError";
  }
}

export const BLOCKER_CATEGORIES: BlockerCategory[] = [
  "missing_documents",
  "missing_information",
  "missing_assignment",
  "preparation_issue",
  "review_rejection",
  "missing_authorization",
  "filing_dependent",
  "technical",
  "other",
];

type Row = Omit<TaskBlocker, "blocks_progress"> & { blocks_progress: number };

function normalise(row: Row): TaskBlocker {
  return {
    ...row,
    blocks_progress: Boolean(row.blocks_progress),
    status: row.status === "resolved" ? "resolved" : "open",
  };
}

function taskAllowed(complianceId: string): void {
  if (!one<{ compliance_id: string }>("SELECT compliance_id FROM compliance WHERE compliance_id = ?", complianceId)) {
    throw new BlockerError("Engagement not found", 404);
  }
}

/** Roles that may participate in blocker management on a task they work on. */
function mayRecord(user: AuthUser, complianceId: string): boolean {
  if (user.role === "manager" || user.role === "partner") return true;
  if (user.role !== "article") return false;
  const task = one<{ preparer: string; reviewer: string; assigned_to: string }>(
    "SELECT preparer, reviewer, assigned_to FROM compliance WHERE compliance_id = ?",
    complianceId,
  );
  return Boolean(task && (task.preparer === user.name || task.reviewer === user.name || task.assigned_to === user.name));
}

export function listBlockers(options: {
  complianceId?: string;
  owner?: string;
  status?: "open" | "resolved";
} = {}): TaskBlocker[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.complianceId) {
    clauses.push("compliance_id = ?");
    params.push(options.complianceId);
  }
  if (options.owner) {
    clauses.push("owner = ?");
    params.push(options.owner);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT * FROM task_blockers ${where} ORDER BY status, created_at DESC`;
  return (getDb().prepare(sql).all(...(params as never[])) as unknown as Row[]).map(normalise);
}

/** Open, progress-blocking rows for one task — the workflow gate reads this. */
export function openBlockingFor(complianceId: string): TaskBlocker[] {
  return listBlockers({ complianceId, status: "open" }).filter((b) => b.blocks_progress);
}

export function createBlocker(input: {
  complianceId: string;
  category: string;
  description: string;
  owner?: string;
  blocksProgress?: boolean;
  user: AuthUser;
}): TaskBlocker {
  taskAllowed(input.complianceId);
  if (!mayRecord(input.user, input.complianceId)) {
    throw new BlockerError("Only the task team, a manager or a partner can record a blocker here", 403);
  }
  if (!isBlockerCategory(input.category)) {
    throw new BlockerError(`Category must be one of: ${BLOCKER_CATEGORIES.join(", ")}`);
  }
  const description = input.description.trim();
  if (description.length < 4) throw new BlockerError("Describe what is blocking the work");
  const task = listCompliance().find((t) => t.compliance_id === input.complianceId);
  if (!task) throw new BlockerError("Engagement not found", 404);

  const blocker: TaskBlocker = {
    blocker_id: nextId("BLK", "task_blockers", "blocker_id"),
    compliance_id: input.complianceId,
    client_id: task.client_id,
    category: input.category as BlockerCategory,
    description: description.slice(0, 500),
    owner: (input.owner ?? "").trim() || input.user.name,
    status: "open",
    blocks_progress: input.blocksProgress ?? true,
    created_by: input.user.name,
    created_at: new Date().toISOString(),
  };
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO task_blockers (blocker_id,compliance_id,client_id,category,description,owner,status,blocks_progress,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        blocker.blocker_id,
        blocker.compliance_id,
        blocker.client_id,
        blocker.category,
        blocker.description,
        blocker.owner,
        blocker.status,
        blocker.blocks_progress ? 1 : 0,
        blocker.created_by,
        blocker.created_at,
      );
    logAudit({
      actor: input.user.name,
      action: "BLOCKER_CREATED",
      entity_type: "compliance",
      entity_id: input.complianceId,
      detail: `${input.category} — ${blocker.description.slice(0, 120)} (owner ${blocker.owner})`,
    });
  });
  return blocker;
}

/**
 * Resolution requires the condition to actually be satisfied — for document
 * and blocker-of-assignment categories the caller (API layer) re-checks the
 * underlying data before allowing the transition; here we record the
 * decision, the resolver and the note.
 */
export function resolveBlocker(input: {
  blockerId: string;
  resolutionNote?: string;
  user: AuthUser;
}): TaskBlocker {
  if (input.user.role !== "manager" && input.user.role !== "partner") {
    throw new BlockerError("Only a manager or partner can resolve a blocker", 403);
  }
  const row = one<Row>("SELECT * FROM task_blockers WHERE blocker_id = ?", input.blockerId);
  if (!row) throw new BlockerError("Blocker not found", 404);
  const blocker = normalise(row);
  if (blocker.status === "resolved") return blocker;
  const now = new Date().toISOString();
  const note = (input.resolutionNote ?? "").trim().slice(0, 300);
  getDb()
    .prepare(
      `UPDATE task_blockers SET status='resolved', resolved_by=?, resolved_at=?, resolution_note=? WHERE blocker_id=?`,
    )
    .run(input.user.name, now, note, blocker.blocker_id);
  logAudit({
    actor: input.user.name,
    action: "BLOCKER_RESOLVED",
    entity_type: "compliance",
    entity_id: blocker.compliance_id,
    detail: `${blocker.category} — ${note || blocker.description.slice(0, 100)}`,
  });
  return normalise(one<Row>("SELECT * FROM task_blockers WHERE blocker_id = ?", blocker.blocker_id)!);
}

export function reopenBlocker(input: { blockerId: string; user: AuthUser; reason?: string }): TaskBlocker {
  if (input.user.role !== "manager" && input.user.role !== "partner") {
    throw new BlockerError("Only a manager or partner can reopen a blocker", 403);
  }
  const row = one<Row>("SELECT * FROM task_blockers WHERE blocker_id = ?", input.blockerId);
  if (!row) throw new BlockerError("Blocker not found", 404);
  const blocker = normalise(row);
  if (blocker.status !== "resolved") return blocker;
  const now = new Date().toISOString();
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new BlockerError("A reason is required to reopen a blocker");
  getDb()
    .prepare(`UPDATE task_blockers SET status='open', resolved_by=NULL, resolved_at=NULL, resolution_note='', reopened_by=?, reopened_at=? WHERE blocker_id=?`)
    .run(input.user.name, now, blocker.blocker_id);
  logAudit({
    actor: input.user.name,
    action: "BLOCKER_REOPENED",
    entity_type: "compliance",
    entity_id: blocker.compliance_id,
    detail: `${blocker.category} — ${reason}`,
  });
  return normalise(one<Row>("SELECT * FROM task_blockers WHERE blocker_id = ?", blocker.blocker_id)!);
}

export { mayRecord as mayManageBlockers };
