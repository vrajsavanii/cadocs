"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileWarning,
  Filter,
  Search,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Badge, Button, EmptyState, Field, PageHeader, StatusPill } from "../ui";
import { Modal, useToast } from "../interactive";
import { dayDiff, prettyDate } from "@/lib/format";

type Task = {
  compliance_id: string;
  client_id: string;
  client_name: string;
  compliance_type: string;
  service_name: string;
  service_code: string;
  line: string;
  period: string;
  period_start?: string | null;
  period_end?: string | null;
  fy: string;
  assessment_year?: string | null;
  due_date: string;
  filed_date?: string | null;
  internal_target_date?: string | null;
  statutory_due_date?: string | null;
  due_date_verified?: boolean;
  statutory_rule_status?: string;
  due_date_source?: string;
  stage: string;
  status: string;
  preparer: string;
  reviewer: string;
  registration_id?: string;
  registration_masked?: string;
  registration_state?: string;
  registration_status?: string;
  docs_total: number;
  docs_pending: number;
  docs_received: number;
  docs_verified: number;
  request_id: string | null;
  filing_reference?: string | null;
  filing_recorded_at?: string | null;
  ack_number?: string | null;
  deadline_state?: string;
  config_warnings?: string[];
  generation_source?: string;
  blocked_reason?: string;
  assignment_state?: string;
  has_open_blockers?: boolean;
  stage_updated_at?: string | null;
};

type Detail = {
  task: Task;
  documents: Array<{ doc_id: string; document_name: string; status: string; category: string }>;
  request: { request_id: string; status: string; reminders_sent: number; reminder_cap: number } | null;
  events: Array<{ event_id: string; note: string; actor: string; created_at: string }>;
  history: Array<{ history_id: string; reason: string; actor: string; created_at: string; to_status: string; to_stage: string | null }>;
  transitions: Array<{ stage: string; label: string; check: { ok: boolean; reason: string; requiresAck?: boolean } }>;
  invoice: { invoice_id: string } | null;
  service: { name: string; line: string; frequency: string; scheduleLabel: string };
  blockers: Array<{
    blocker_id: string;
    category: string;
    description: string;
    owner: string;
    status: string;
    blocks_progress: boolean;
    created_by: string;
    created_at: string;
    resolution_note?: string;
    resolved_by?: string | null;
  }>;
  assignment_history: Array<{
    assignment_id: string;
    responsibility: string;
    previous_assignee: string;
    new_assignee: string;
    actor: string;
    reason: string;
    created_at: string;
  }>;
};

const BLOCKER_LABEL: Record<string, string> = {
  missing_documents: "Missing client documents",
  missing_information: "Incomplete client information",
  missing_assignment: "Missing staff assignment",
  preparation_issue: "Preparation issue",
  review_rejection: "Review rejection",
  missing_authorization: "Missing authorization",
  filing_dependent: "Filing dependency",
  technical: "Technical failure",
  other: "Other",
};

const STAGE_LABEL: Record<string, string> = {
  documents: "Documents",
  preparation: "Preparation",
  review: "Review",
  filing: "Portal filing",
  signoff: "CA sign-off",
  done: "Done",
};

const DEADLINE_LABEL: Record<string, string> = {
  not_due: "Not yet due",
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue",
  blocked_documents: "Blocked — documents",
  blocked_assignment: "Blocked — assignment",
  awaiting_review: "Awaiting review",
  awaiting_filing_evidence: "Awaiting filing evidence",
  completed: "Completed",
  statutory_unknown: "No deadline",
};

const FILTERS = ["All", "Mine", "Overdue", "Due soon", "Unassigned", "Review", "Filing"] as const;
type Filter = (typeof FILTERS)[number];

export function WorkflowView({
  data,
  staff,
  role,
  focusTaskId,
}: {
  data: {
    totals: { open: number; dueThisWeek: number; overdue: number; docsPending: number; awaitingSignoff: number; completedThisMonth: number; unassigned?: number; blocked?: number; awaitingReview?: number };
    myWork: Task[];
    tasks: Task[];
    serviceLines: Array<{ key: string; label: string; open: number }>;
    unassigned?: Task[];
    blocked?: Task[];
    team?: Array<{ name: string; role: string; preparer_open: number; reviewer_open: number; overdue: number; due_soon: number; awaiting_review: number; blocked: number; completed_this_month: number }>;
    viewer_role?: string;
  };
  staff: Array<{ name: string; role: string }>;
  role: string;
  focusTaskId?: string;}) {
  const router = useRouter();
  const [focusHandled, setFocusHandled] = React.useState(false);
  const { toast } = useToast();
  const [filter, setFilter] = React.useState<Filter>("All");
  const [line, setLine] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [loadingId, setLoadingId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [ack, setAck] = React.useState("");
  const [note, setNote] = React.useState("");
  const [preparer, setPreparer] = React.useState("");
  const [reviewer, setReviewer] = React.useState("");
  const [filingRef, setFilingRef] = React.useState("");
  const [filingDate, setFilingDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [filingNote, setFilingNote] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [targetReason, setTargetReason] = React.useState("");
  const [statutoryDate, setStatutoryDate] = React.useState("");
  const [authority, setAuthority] = React.useState("");
  const [statutoryReason, setStatutoryReason] = React.useState("");
  const [blockerCategory, setBlockerCategory] = React.useState("other");
  const [blockerText, setBlockerText] = React.useState("");
  const [assignReason, setAssignReason] = React.useState("");
  const canSupervise = role === "manager" || role === "partner";
  const myNames = new Set(data.myWork.map((task) => task.compliance_id));

  React.useEffect(() => {
    if (!focusTaskId || focusHandled) return;
    setFocusHandled(true);
    void openTask(focusTaskId);
    // openTask is stable enough for this one-shot deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, focusHandled]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.tasks.filter((task) => {
      if (filter === "Mine" && !myNames.has(task.compliance_id)) return false;
      if (filter === "Overdue" && task.deadline_state !== "overdue") return false;
      if (filter === "Due soon" && !["due_soon", "due_today"].includes(task.deadline_state ?? "")) return false;
      if (filter === "Unassigned" && task.preparer && task.reviewer) return false;
      if (filter === "Review" && task.stage !== "review") return false;
      if (filter === "Filing" && !["filing", "signoff"].includes(task.stage)) return false;
      if (line !== "all" && task.line !== line) return false;
      if (!q) return true;
      return [task.client_name, task.compliance_type, task.period, task.preparer, task.reviewer, task.registration_masked]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.tasks, filter, line, query, myNames]);

  async function openTask(id: string) {
    setLoadingId(id);
    setDetail(null);
    try {
      const res = await fetch(`/api/engagements/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => ({}))) as Detail & { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not load the engagement");
      setDetail(body);
      setAck(body.task.ack_number || body.task.filing_reference || "");
      setNote("");
      setPreparer(body.task.preparer || "");
      setReviewer(body.task.reviewer || "");
      setFilingRef(body.task.filing_reference || body.task.ack_number || "");
      setFilingDate(body.task.filed_date || new Date().toISOString().slice(0, 10));
      setFilingNote("");
      setTargetDate(body.task.internal_target_date || body.task.due_date || "");
      setTargetReason("");
      setStatutoryDate(body.task.statutory_due_date || "");
      setAuthority("");
      setStatutoryReason("");
      setBlockerCategory("other");
      setBlockerText("");
      setAssignReason("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load the engagement", "error");
    } finally {
      setLoadingId("");
    }
  }

  async function act(body: Record<string, unknown>, success: string) {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/engagements/${encodeURIComponent(detail.task.compliance_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { detail?: Detail; error?: string };
      if (!res.ok) throw new Error(payload.error || "Action failed");
      if (payload.detail) setDetail(payload.detail);
      toast(success);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function transition(target: string) {
    void act(
      {
        action: "advance",
        target,
        note,
        ack_number: ["filing", "signoff", "done"].includes(target) ? ack : "",
        // Optimistic-lock token: refuse the write if someone else already
        // moved this engagement after this browser loaded it (server → 409).
        expected_stage_updated_at: detail?.task.stage_updated_at ?? "",
      },
      `${STAGE_LABEL[detail?.task.stage ?? ""] ?? "Stage"} → ${STAGE_LABEL[target] ?? target}`,
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Engagement engine"
        title="Recurring engagements"
        description="One row per client, service, registration and period. Statutory dates appear only when a verified rule exists."
      >
        <Link href="/compliance" className="inline-flex h-9 items-center gap-2 rounded-full bg-sage px-4 text-xs font-bold text-sage-ink hover:bg-[#dce8de]">
          <CalendarClock className="h-4 w-4" /> Compliance calendar
        </Link>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open" value={data.totals.open} icon={<Clock3 className="h-4 w-4" />} />
        <Stat label="Overdue" value={data.totals.overdue} tone="rose" icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Due this week" value={data.totals.dueThisWeek} tone="gold" icon={<CalendarClock className="h-4 w-4" />} />
        <Stat label="Awaiting sign-off" value={data.totals.awaitingSignoff} tone="gold" icon={<ShieldAlert className="h-4 w-4" />} />
        <Stat label="Blocked / unassigned" value={(data.totals.blocked ?? 0) + (data.totals.unassigned ?? 0)} tone="rose" icon={<ShieldAlert className="h-4 w-4" />} />
      </div>

      {data.team && data.team.length > 0 ? (
        <div className="card mb-3 overflow-hidden">
          <p className="border-b border-black/5 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">Team workload — open counts per person (preparer / reviewer)</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-subtle/60 text-left">
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Person</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Preparer</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Reviewer</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Awaiting review</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Overdue</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Due soon</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Blocked</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Done this month</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((row) => (
                  <tr key={row.name} className="border-t border-black/5 text-[11px]">
                    <td className="px-3 py-2 font-semibold text-ink">{row.name} · {row.role}</td>
                    <td className="px-3 py-2 text-muted">{row.preparer_open}</td>
                    <td className="px-3 py-2 text-muted">{row.reviewer_open}</td>
                    <td className="px-3 py-2 text-muted">{row.awaiting_review}</td>
                    <td className={`px-3 py-2 font-semibold ${row.overdue > 0 ? "text-[#A33B2E]" : "text-muted"}`}>{row.overdue}</td>
                    <td className={`px-3 py-2 ${row.due_soon > 0 ? "text-[#8A6420] font-semibold" : "text-muted"}`}>{row.due_soon}</td>
                    <td className={`px-3 py-2 ${row.blocked > 0 ? "text-[#A33B2E] font-semibold" : "text-muted"}`}>{row.blocked}</td>
                    <td className="px-3 py-2 text-muted">{row.completed_this_month}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 p-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                  filter === value ? "bg-green text-white" : "bg-subtle text-muted hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] text-muted">
              <Filter className="h-3.5 w-3.5" />
              <select className="bg-transparent text-ink outline-none" value={line} onChange={(event) => setLine(event.target.value)}>
                <option value="all">All services</option>
                {data.serviceLines.map((service) => <option key={service.key} value={service.key}>{service.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] text-muted">
              <Search className="h-3.5 w-3.5" />
              <input
                className="w-40 bg-transparent text-[11px] text-ink outline-none"
                placeholder="Search…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 className="h-5 w-5" />}
            title="No engagements in this view"
            description="Change the filter, or generate the current period from the compliance calendar."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="bg-subtle/60 text-left">
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Client / engagement</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Registration</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Period</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Team</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Deadline</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Stage</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const days = dayDiff(task.due_date);
                  const statutory = Boolean(task.due_date_verified && task.statutory_due_date);
                  const tone =
                    task.deadline_state === "overdue" || days < 0
                      ? "red"
                      : task.deadline_state === "blocked_assignment"
                        ? "purple"
                        : task.deadline_state === "blocked_documents"
                          ? "amber"
                          : "neutral";
                  return (
                    <tr key={task.compliance_id} className="border-t border-black/5 align-top hover:bg-subtle/30">
                      <td className="px-3 py-3">
                        <p className="text-xs font-bold text-ink">{task.client_name}</p>
                        <p className="text-[11px] text-muted">{task.service_name} · {task.period}</p>
                        {task.config_warnings?.length ? (
                          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#8A6420]">
                            <AlertTriangle className="h-3 w-3" /> {task.config_warnings[0]}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted">
                        {task.registration_masked ? (
                          <>
                            <p className="font-semibold text-ink">{task.registration_masked}</p>
                            <p>{task.registration_state || "GST registration"} · {task.registration_status || "status unknown"}</p>
                          </>
                        ) : (
                          <span className="text-muted">Client-level</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted">
                        <p className="font-semibold text-ink">{task.period}</p>
                        <p>{task.fy}{task.assessment_year ? ` · AY ${task.assessment_year}` : ""}</p>
                        <p>{task.period_start && task.period_end ? `${task.period_start} → ${task.period_end}` : ""}</p>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted">
                        <p><span className="font-semibold text-ink">Prep</span> {task.preparer || <span className="text-[#A33B2E]">Unassigned</span>}</p>
                        <p><span className="font-semibold text-ink">Rev</span> {task.reviewer || <span className="text-[#A33B2E]">Unassigned</span>}</p>
                      </td>
                      <td className="px-3 py-3 text-[11px]">
                        <p className="font-semibold text-ink">{prettyDate(task.due_date)}</p>
                        <p className={`text-[10px] ${days < 0 ? "text-[#A33B2E]" : "text-muted"}`}>
                          {statutory ? "Statutory due" : "Internal target"} · {DEADLINE_LABEL[task.deadline_state ?? ""] ?? `${days}d`}
                        </p>
                        {!statutory ? <Badge tone="amber">Statutory unverified</Badge> : <Badge tone="green">Verified statutory</Badge>}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={tone === "red" ? "red" : tone === "amber" ? "amber" : "neutral"}>{STAGE_LABEL[task.stage] ?? task.stage}</Badge>
                        <p className="mt-1 text-[10px] text-muted">{task.status}</p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => void openTask(task.compliance_id)} loading={loadingId === task.compliance_id}>
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(detail) || Boolean(loadingId)}
        onClose={() => {
          setDetail(null);
          setLoadingId("");
        }}
        title={detail ? `${detail.task.client_name} · ${detail.task.compliance_type}` : "Loading engagement…"}
        description={detail ? `${detail.task.period} · ${detail.service.name}` : "Reading the engagement trail"}
        wide
      >
        {detail ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Registration">
                {detail.task.registration_masked ? `${detail.task.registration_masked} · ${detail.task.registration_state || "GST"} · ${detail.task.registration_status || "status unknown"}` : "Client-level work"}
              </Fact>
              <Fact label="Period">
                {detail.task.period}
                <span className="block text-[11px] text-muted">
                  {detail.task.period_start} → {detail.task.period_end} · FY {detail.task.fy}
                  {detail.task.assessment_year ? ` · AY ${detail.task.assessment_year}` : ""}
                </span>
              </Fact>
              <Fact label="Internal target">
                {detail.task.internal_target_date ? prettyDate(detail.task.internal_target_date) : "Not set"}
                <span className="block text-[11px] text-muted">{detail.task.due_date_source}</span>
              </Fact>
              <Fact label="Statutory due date">
                {detail.task.statutory_due_date ? (
                  <>
                    {prettyDate(detail.task.statutory_due_date)}
                    <Badge tone={detail.task.due_date_verified ? "green" : "amber"} className="ml-1">
                      {detail.task.due_date_verified ? "verified" : "unverified"}
                    </Badge>
                  </>
                ) : (
                  <span className="text-[#8A6420]">Not verified — no statutory date is claimed</span>
                )}
              </Fact>
              <Fact label="Preparer">{detail.task.preparer || "Unassigned"}</Fact>
              <Fact label="Reviewer">{detail.task.reviewer || "Unassigned"}</Fact>
              <Fact label="Filing evidence">
                {detail.task.filing_reference ? (
                  <>
                    {detail.task.filing_reference}
                    <span className="block text-[11px] text-muted">
                      recorded {detail.task.filing_recorded_at ? prettyDate(detail.task.filing_recorded_at) : ""} by a user · not integration-confirmed
                    </span>
                  </>
                ) : (
                  "None recorded"
                )}
              </Fact>
              <Fact label="Documents">
                {detail.task.docs_verified} verified · {detail.task.docs_received} received · {detail.task.docs_pending} pending
              </Fact>
            </div>

            {detail.task.config_warnings?.length ? (
              <div className="rounded-2xl bg-gold-soft/60 px-3 py-2 text-[11px] text-[#6D4E16]">
                <p className="font-bold">Configuration checks</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {detail.task.config_warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : null}

            <div className="rounded-2xl border border-black/5">
              <p className="border-b border-black/5 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">Workflow</p>
              <div className="flex flex-wrap gap-2 p-3">
                {detail.transitions.map((option) => (
                  <Button
                    key={option.stage}
                    size="sm"
                    variant={option.check.ok ? "primary" : "secondary"}
                    disabled={!option.check.ok || busy}
                    title={option.check.reason}
                    onClick={() => transition(option.stage)}
                  >
                    {STAGE_LABEL[option.stage] ?? option.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 border-t border-black/5 p-3 sm:grid-cols-2">
                <Field label="Stage note / reason">
                  <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required when sending work back" />
                </Field>
                <Field label="Acknowledgement / ARN">
                  <input className="input" value={ack} onChange={(event) => setAck(event.target.value)} placeholder="Enter only real filing evidence" />
                </Field>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Assign team</p>
                <div className="grid gap-2">
                  <Field label="Preparer">
                    <select className="input" value={preparer} onChange={(event) => setPreparer(event.target.value)}>
                      <option value="">Unassigned</option>
                      {staff.map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}
                    </select>
                  </Field>
                  <Field label="Reviewer">
                    <select className="input" value={reviewer} onChange={(event) => setReviewer(event.target.value)}>
                      <option value="">Unassigned</option>
                      {staff.map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}
                    </select>
                  </Field>
                  <Field label="Reason (recorded with the assignment)">
                    <input
                      className="input"
                      value={assignReason}
                      onChange={(event) => setAssignReason(event.target.value)}
                      placeholder="Who changed what, and why — kept in the assignment ledger"
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() => void act({ action: "assign", preparer, reviewer, reason: assignReason }, "Assignments updated")}
                  >
                    <UserRound className="h-3.5 w-3.5" /> Save assignment
                  </Button>
                  {detail.assignment_history.length > 0 ? (
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl bg-subtle p-2">
                      {detail.assignment_history.map((entry) => (
                        <p key={entry.assignment_id} className="text-[10px] text-muted">
                          <span className="font-semibold text-ink">
                            {entry.responsibility === "preparer" ? "Preparer" : "Reviewer"}:
                          </span>{" "}
                          {entry.previous_assignee || "—"} → {entry.new_assignee || "—"} · {entry.actor} · {entry.reason}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  <ShieldAlert className="h-3.5 w-3.5" /> Blockers
                </p>
                <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
                  {detail.blockers.length === 0 ? <p className="text-[11px] text-muted">No blockers recorded.</p> : null}
                  {detail.blockers.map((blocker) => (
                    <div key={blocker.blocker_id} className="rounded-xl bg-subtle px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{BLOCKER_LABEL[blocker.category] ?? blocker.category}</span>
                        <Badge tone={blocker.status === "open" ? (blocker.blocks_progress ? "red" : "amber") : "green"}>
                          {blocker.status === "open" ? (blocker.blocks_progress ? "Blocking" : "Watch") : "Resolved"}
                        </Badge>
                      </div>
                      <p className="text-muted">{blocker.description}</p>
                      <p className="text-[10px] text-muted">{blocker.owner} · {blocker.created_by} · {new Date(blocker.created_at).toLocaleString("en-IN")}</p>
                      {canSupervise && blocker.status === "open" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-1"
                          loading={busy}
                          onClick={() => void act({ action: "blocker_resolve", blocker_id: blocker.blocker_id, resolution_note: note }, "Blocker resolved")}
                        >
                          Resolve
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="grid gap-2">
                  <Field label="Why the work is blocked">
                    <select className="input" value={blockerCategory} onChange={(event) => setBlockerCategory(event.target.value)}>
                      {Object.entries(BLOCKER_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Describe it">
                    <input className="input" value={blockerText} onChange={(event) => setBlockerText(event.target.value)} placeholder="What is missing, and who owns clearing it" />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() => void act({ action: "blocker_open", category: blockerCategory, description: blockerText }, "Blocker recorded")}
                  >
                    Record blocker
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Record filing evidence</p>
                <div className="grid gap-2">
                  <Field label="Acknowledgement / ARN">
                    <input className="input" value={filingRef} onChange={(event) => setFilingRef(event.target.value)} />
                  </Field>
                  <Field label="Filed on">
                    <input className="input" type="date" value={filingDate} onChange={(event) => setFilingDate(event.target.value)} />
                  </Field>
                  <Field label="Note">
                    <input className="input" value={filingNote} onChange={(event) => setFilingNote(event.target.value)} placeholder="Optional" />
                  </Field>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void act({ action: "record_filing", reference: filingRef, filed_on: filingDate, note: filingNote }, "Filing evidence recorded")}>
                    <FileCheck2 className="h-3.5 w-3.5" /> Record evidence
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Internal target override</p>
                <div className="grid gap-2">
                  <Field label="New target"><input className="input" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></Field>
                  <Field label="Reason"><input className="input" value={targetReason} onChange={(event) => setTargetReason(event.target.value)} /></Field>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void act({ action: "set_internal_target", date: targetDate, reason: targetReason }, "Internal target updated")}>
                    Save target
                  </Button>
                </div>
              </div>
              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  <ShieldAlert className="h-3.5 w-3.5" /> Statutory override (partner only)
                </p>
                <div className="grid gap-2">
                  <Field label="Statutory date"><input className="input" type="date" value={statutoryDate} onChange={(event) => setStatutoryDate(event.target.value)} /></Field>
                  <Field label="Authority reference"><input className="input" value={authority} onChange={(event) => setAuthority(event.target.value)} placeholder="Notification / circular" /></Field>
                  <Field label="Reason"><input className="input" value={statutoryReason} onChange={(event) => setStatutoryReason(event.target.value)} /></Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    disabled={role !== "partner"}
                    onClick={() => void act({ action: "override_statutory", date: statutoryDate, authority_reference: authority, reason: statutoryReason }, "Statutory date overridden with audit trail")}
                  >
                    Override statutory date
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Status & audit history</p>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {detail.history.length === 0 ? <p className="text-[11px] text-muted">No history recorded yet.</p> : null}
                  {detail.history.map((entry) => (
                    <div key={entry.history_id} className="rounded-xl bg-subtle px-2.5 py-2 text-[11px]">
                      <p className="font-semibold text-ink">{entry.to_stage ? (STAGE_LABEL[entry.to_stage] ?? entry.to_stage) : entry.to_status}</p>
                      <p className="text-muted">{entry.reason}</p>
                      <p className="text-[10px] text-muted">{entry.actor} · {new Date(entry.created_at).toLocaleString("en-IN")}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-black/5 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Documents & links</p>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {detail.documents.map((doc) => (
                    <div key={doc.doc_id} className="flex items-center justify-between gap-2 rounded-xl bg-subtle px-2.5 py-1.5 text-[11px]">
                      <span className="truncate text-ink">{doc.document_name}</span>
                      <Badge tone={doc.status === "Verified" ? "green" : doc.status === "Rejected" ? "red" : "amber"}>{doc.status}</Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link className="text-[11px] font-bold text-green underline" href={`/clients?client=${encodeURIComponent(detail.task.client_id)}`}>
                    Open client 360°
                  </Link>
                  {detail.invoice ? <Badge tone="blue">Invoice {detail.invoice.invoice_id}</Badge> : null}
                  {detail.request ? <Badge tone="neutral">Request {detail.request.request_id} · {detail.request.reminders_sent}/{detail.request.reminder_cap} reminders</Badge> : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-black/5 pt-3">
              {detail.task.stage === "done" ? (
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void act({ action: "advance", target: "signoff", note }, "Engagement reopened for correction")}>
                  Reopen for correction
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-xs text-muted">Loading engagement…</p>
        )}
      </Modal>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-subtle px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-0.5 text-[12px] font-semibold text-ink">{children}</div>
    </div>
  );
}

function Stat({ label, value, icon, tone = "sage" }: { label: string; value: number; icon: React.ReactNode; tone?: "sage" | "gold" | "rose" }) {
  const tones = { sage: "bg-sage text-sage-ink", gold: "bg-gold-soft text-gold", rose: "bg-[#FBEAE7] text-[#A33B2E]" };
  return (
    <div className="card flex items-center gap-3 p-3">
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div>
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight text-ink">{value}</p>
      </div>
    </div>
  );
}
