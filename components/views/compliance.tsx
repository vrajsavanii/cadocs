"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  Repeat,
  ShieldAlert,
} from "lucide-react";
import type { Client, Compliance, WorkflowTask } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { dayDiff, prettyDate, relativeDeadline } from "@/lib/format";

const FILTERS = ["All", "Overdue", "Due 7 days", "Pending", "Filed"] as const;
type Filter = (typeof FILTERS)[number];

function monthLabel(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

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
  blocked_documents: "Documents pending",
  blocked_assignment: "Assignment missing",
  awaiting_review: "Awaiting review",
  awaiting_filing_evidence: "Filing evidence missing",
  completed: "Completed",
  statutory_unknown: "No deadline",
};

type PreviewItem = {
  service_id: string;
  client_name: string;
  service_name: string;
  registration_masked: string;
  period: string;
  period_start: string;
  period_end: string;
  internal_target_date: string;
  statutory_due_date: string | null;
  action: string;
  warnings: string[];
  reason: string;
};

type Preview = {
  summary: { processed: number; create: number; exists: number; skipped: number; invalid: number; warnings: number };
  items: PreviewItem[];
  window: { from: string; to: string };
};

export function ComplianceView({
  tasks,
  clients,
  firmName,
}: {
  tasks: WorkflowTask[];
  clients: Client[];
  firmName: string;
}) {
  const [view, setView] = React.useState<"list" | "calendar">("list");
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [service, setService] = React.useState("all");
  const [preparer, setPreparer] = React.useState("all");
  const [assignment, setAssignment] = React.useState("all");
  const [statutory, setStatutory] = React.useState("all");
  const [month, setMonth] = React.useState(() => new Date());
  const [addOpen, setAddOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [firmBusy, setFirmBusy] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();

  const [form, setForm] = React.useState({
    client_id: clients[0]?.client_id ?? "",
    compliance_type: "GST Filing (GSTR-3B)",
    period: monthLabel(-1),
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    assigned_to: "",
    notes: "",
  });

  const clientByName = React.useMemo(() => new Map(clients.map((c) => [c.name, c])), [clients]);
  const services = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) map.set(task.service_code, task.service_name || task.service_code);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);
  const preparers = React.useMemo(() => [...new Set(tasks.flatMap((task) => [task.preparer, task.reviewer]).filter(Boolean))].sort(), [tasks]);

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    const today = isoDate(new Date());
    return tasks.filter((task) => {
      const days = dayDiff(task.internal_target_date || task.due_date);
      const matchesFilter =
        filter === "All" ||
        (filter === "Overdue" && task.status !== "Filed" && (task.internal_target_date || task.due_date) < today) ||
        (filter === "Due 7 days" && task.status !== "Filed" && days >= 0 && days <= 7) ||
        (filter === "Pending" && task.status === "Pending") ||
        (filter === "Filed" && task.status === "Filed");
      const matchesQuery =
        !q ||
        [task.client_name, task.compliance_type, task.period, task.preparer, task.reviewer, task.registration_masked]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchesService = service === "all" || task.service_code === service;
      const matchesPreparer = preparer === "all" || task.preparer === preparer || task.reviewer === preparer;
      const matchesAssignment =
        assignment === "all" ||
        (assignment === "missing" && (!task.preparer || !task.reviewer)) ||
        (assignment === "assigned" && Boolean(task.preparer && task.reviewer));
      const matchesStatutory =
        statutory === "all" ||
        (statutory === "unverified" && !task.due_date_verified) ||
        (statutory === "verified" && task.due_date_verified);
      return matchesFilter && matchesQuery && matchesService && matchesPreparer && matchesAssignment && matchesStatutory;
    });
  }, [tasks, filter, query, service, preparer, assignment, statutory]);

  const open = tasks.filter((c) => c.status !== "Filed");
  const overdue = tasks.filter((c) => c.status !== "Filed" && (c.internal_target_date || c.due_date) < isoDate(new Date())).length;
  const dueWeek = open.filter((c) => {
    const days = dayDiff(c.internal_target_date || c.due_date);
    return days >= 0 && days <= 7;
  }).length;
  const unverified = tasks.filter((task) => !task.due_date_verified).length;
  const filed = tasks.filter((c) => c.status === "Filed").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Compliance>("/api/compliance", "POST", form, "Compliance task created");
    if (created) setAddOpen(false);
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/engagements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: from || undefined, to: to || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as Preview & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not prepare the preview");
      setPreview(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not prepare the preview", "error");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function commitPreview() {
    if (!preview) return;
    setFirmBusy(true);
    try {
      const res = await fetch("/api/engagements/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: from || undefined, to: to || undefined, confirmed: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: { created: number; skipped: number; failed: number }; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not generate engagements");
      toast(`${data.run?.created ?? 0} engagement(s) created · ${data.run?.skipped ?? 0} skipped${data.run?.failed ? ` · ${data.run.failed} failed` : ""}`);
      setPreviewOpen(false);
      setPreview(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not generate engagements", "error");
    } finally {
      setFirmBusy(false);
    }
  }

  const grid = monthGrid(month);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const tasksByDay = new Map<string, WorkflowTask[]>();
  for (const task of filtered) {
    const date = task.internal_target_date || task.due_date;
    tasksByDay.set(date, [...(tasksByDay.get(date) ?? []), task]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Statutory desk"
        title="Compliance calendar"
        description="Every GST, TDS, ROC and audit deadline, with internal targets clearly separated from verified statutory dates."
      >
        <AiAssist task="week_plan" label="Plan my week" />
        <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
          <Repeat className="h-4 w-4" /> Generate engagements
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New task
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Open tasks" value={open.length} icon={<CalendarCheck2 className="h-4 w-4" />} />
        <MiniStat label="Due this week" value={dueWeek} icon={<BellRing className="h-4 w-4" />} tone="gold" />
        <MiniStat label="Overdue" value={overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="rose" />
        <MiniStat label="Unverified statutory dates" value={unverified} icon={<ShieldAlert className="h-4 w-4" />} tone="gold" />
      </div>

      <SectionCard
        title={`${filtered.length} tasks`}
        subtitle="Statistical due dates are shown only where a verified rule exists; otherwise the internal target is labelled."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full bg-subtle p-1">
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${view === "list" ? "bg-white text-ink shadow-sm" : "text-muted"}`}
                onClick={() => setView("list")}
              >
                <List className="h-3.5 w-3.5" /> List
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${view === "calendar" ? "bg-white text-ink shadow-sm" : "text-muted"}`}
                onClick={() => setView("calendar")}
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
            </div>
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search tasks…" className="w-full sm:w-52" />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <select className="input h-8 max-w-[180px] text-[11px]" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="all">All services</option>
            {services.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <select className="input h-8 max-w-[170px] text-[11px]" value={preparer} onChange={(e) => setPreparer(e.target.value)}>
            <option value="all">Any preparer/reviewer</option>
            {preparers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="input h-8 max-w-[170px] text-[11px]" value={assignment} onChange={(e) => setAssignment(e.target.value)}>
            <option value="all">Any assignment</option>
            <option value="missing">Assignment missing</option>
            <option value="assigned">Fully assigned</option>
          </select>
          <select className="input h-8 max-w-[190px] text-[11px]" value={statutory} onChange={(e) => setStatutory(e.target.value)}>
            <option value="all">Any due-date status</option>
            <option value="verified">Verified statutory only</option>
            <option value="unverified">Unverified / internal only</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No tasks in this view" description="Change the filter, or generate the current period from configured services." />
        ) : view === "calendar" ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Button size="sm" variant="secondary" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <p className="text-sm font-bold text-ink">{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
              <Button size="sm" variant="secondary" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-2 py-1">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((date) => {
                const iso = isoDate(date);
                const dayTasks = tasksByDay.get(iso) ?? [];
                const inMonth = iso.slice(0, 7) === monthKey;
                return (
                  <div key={iso} className={`min-h-24 rounded-xl border border-black/5 p-1.5 ${inMonth ? "bg-white" : "bg-subtle/50"}`}>
                    <p className={`mb-1 text-[10px] font-bold ${inMonth ? "text-ink" : "text-muted"}`}>{date.getDate()}</p>
                    <div className="space-y-1">
                      {dayTasks.slice(0, 3).map((task) => (
                        <Link
                          key={task.compliance_id}
                          href={`/workflow?task=${encodeURIComponent(task.compliance_id)}`}
                          className={`block truncate rounded-md px-1.5 py-1 text-[9px] font-semibold ${
                            task.due_date_verified ? "bg-sage text-sage-ink" : "bg-gold-soft/70 text-[#6D4E16]"
                          }`}
                          title={`${task.client_name} · ${task.compliance_type} · ${task.due_date_verified ? "statutory" : "internal target"}`}
                        >
                          {task.client_name.split(" ")[0]} · {task.service_code}
                        </Link>
                      ))}
                      {dayTasks.length > 3 ? <p className="text-[9px] text-muted">+{dayTasks.length - 3} more</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted">Green = verified statutory date · gold = internal target (statutory unverified). Click a task to open its engagement.</p>
          </div>
        ) : (
          <TableShell>
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Client</Th>
                  <Th>Task</Th>
                  <Th>Registration</Th>
                  <Th>Period</Th>
                  <Th>Deadline</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const days = dayDiff(c.internal_target_date || c.due_date);
                  const client = clientByName.get(c.client_name);
                  const contact = client?.contact_person || c.client_name;
                  const verified = Boolean(c.due_date_verified && c.statutory_due_date);
                  return (
                    <tr key={c.compliance_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.client_name} />
                          <div>
                            <p className="text-xs font-semibold text-ink">{c.client_name}</p>
                            <p className="text-[10px] text-muted">{c.preparer || "Preparer unassigned"} · {c.reviewer || "Reviewer unassigned"}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <p className="text-xs font-semibold text-ink">{c.compliance_type}</p>
                        <p className="text-[10px] text-muted">
                          {c.compliance_id} · {STAGE_LABEL[c.stage ?? "documents"]}
                          {c.deadline_state ? ` · ${DEADLINE_LABEL[c.deadline_state] ?? c.deadline_state}` : ""}
                        </p>
                      </Td>
                      <Td>
                        <span className="text-[11px] text-muted">{c.registration_masked || "Client-level"}</span>
                        {c.registration_status && c.registration_status !== "Active" ? <Badge tone="red">{c.registration_status}</Badge> : null}
                      </Td>
                      <Td><span className="text-[11px] text-muted">{c.period}</span></Td>
                      <Td>
                        <p className="text-xs font-semibold text-ink">{prettyDate(c.internal_target_date || c.due_date)}</p>
                        <p className={`text-[10px] ${c.status === "Filed" ? "text-muted" : days < 0 ? "text-[#A33B2E]" : days <= 7 ? "text-[#8A6420]" : "text-muted"}`}>
                          {c.status === "Filed" ? `Filed ${prettyDate(c.filed_date)}` : relativeDeadline(c.internal_target_date || c.due_date)}
                        </p>
                        <Badge tone={verified ? "green" : "amber"}>{verified ? "Statutory verified" : "Internal target · statutory unverified"}</Badge>
                      </Td>
                      <Td><StatusPill status={c.status} /></Td>
                      <Td className="text-right">
                        {c.status === "Filed" ? (
                          <Badge tone="green">{c.filing_reference || c.ack_number || "Filed"}</Badge>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <ReminderButton
                              recipient={c.client_name}
                              phone={client?.phone}
                              email={client?.email}
                              subject={`${c.compliance_type} — ${c.period}`}
                              relatedType="compliance"
                              relatedId={c.compliance_id}
                              message={`Dear ${contact},\n\nThis is a reminder that ${c.compliance_type} for ${c.period} is due on ${prettyDate(c.internal_target_date || c.due_date)} and is currently ${c.status.toLowerCase()}. Please share the pending details so we can file on time.\n\nRegards,\n${firmName}`}
                            />
                            <Link
                              href={`/workflow?task=${encodeURIComponent(c.compliance_id)}`}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sage px-3 text-xs font-semibold text-sage-ink transition hover:bg-[#dce8de]"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Open engagement
                            </Link>
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New compliance task" description="Add a one-off statutory filing with an internal target date.">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client" className="sm:col-span-2">
              <select required className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Task type" className="sm:col-span-2">
              <input className="input" value={form.compliance_type} onChange={(e) => setForm({ ...form, compliance_type: e.target.value })} />
            </Field>
            <Field label="Period"><input className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Sep 2026" /></Field>
            <Field label="Internal target"><input required type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Assigned to"><input className="input" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} placeholder="Ananya Iyer" /></Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></Field>
          </div>
          <p className="rounded-xl bg-gold-soft/60 px-3 py-2 text-[10px] text-muted">
            Manual tasks carry an internal target only. A statutory due date is never asserted here.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create task</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreview(null);
        }}
        title="Generate recurring engagements"
        description="Preview first. Nothing is written until you confirm."
        wide
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From (period end)">
              <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To (period end)">
              <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <p className="rounded-xl bg-subtle px-3 py-2 text-[10px] leading-relaxed text-muted">
            Leave both blank to generate the current completed period for every active service. Existing engagements keep their stage,
            assignment, checklist and filing evidence — a retry cannot duplicate or reset work.
          </p>
          <Button variant="secondary" loading={previewBusy} onClick={() => void runPreview()}>
            <Repeat className="h-4 w-4" /> Preview generation
          </Button>

          {preview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Badge tone="green">Create {preview.summary.create}</Badge>
                <Badge tone="neutral">Exists {preview.summary.exists}</Badge>
                <Badge tone="amber">Skipped {preview.summary.skipped}</Badge>
                <Badge tone="red">Invalid {preview.summary.invalid}</Badge>
                <Badge tone="blue">Warnings {preview.summary.warnings}</Badge>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-black/5">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-subtle text-[10px] uppercase text-muted">
                    <tr><th className="px-2 py-1.5">Client / service</th><th className="px-2 py-1.5">Registration</th><th className="px-2 py-1.5">Period</th><th className="px-2 py-1.5">Target</th><th className="px-2 py-1.5">Action</th></tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 100).map((item, index) => (
                      <tr key={`${item.service_id}-${item.period}-${index}`} className="border-t border-black/5">
                        <td className="px-2 py-1.5">
                          <p className="font-semibold text-ink">{item.client_name}</p>
                          <p className="text-[10px] text-muted">{item.service_name}</p>
                        </td>
                        <td className="px-2 py-1.5 text-muted">{item.registration_masked || "—"}</td>
                        <td className="px-2 py-1.5 text-muted">{item.period || "—"}</td>
                        <td className="px-2 py-1.5 text-muted">{item.internal_target_date || "—"}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={item.action === "create" ? "green" : item.action === "exists" ? "neutral" : item.action === "invalid" ? "red" : "amber"}>{item.action}</Badge>
                          {item.warnings.length ? <p className="mt-1 max-w-[260px] text-[9px] text-[#8A6420]">{item.warnings[0]}</p> : null}
                          {item.reason ? <p className="mt-1 max-w-[260px] text-[9px] text-muted">{item.reason}</p> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.items.length > 100 ? <p className="p-2 text-[10px] text-muted">Showing the first 100 of {preview.items.length} proposed rows.</p> : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)}>Back</Button>
                <Button loading={firmBusy} disabled={preview.summary.create === 0} onClick={() => void commitPreview()}>
                  <Repeat className="h-4 w-4" /> Create {preview.summary.create} engagement(s)
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, icon, tone = "sage" }: { label: string; value: number; icon: React.ReactNode; tone?: "sage" | "gold" | "rose" }) {
  const tones = { sage: "bg-sage text-sage-ink", gold: "bg-gold-soft text-gold", rose: "bg-[#FBEAE7] text-[#A33B2E]" };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight text-ink">{value}</p>
      </div>
    </div>
  );
}
