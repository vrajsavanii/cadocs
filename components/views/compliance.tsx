"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CalendarCheck2, CheckCircle2, Plus, Repeat } from "lucide-react";
import type { Client, Compliance } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { dayDiff, prettyDate, relativeDeadline } from "@/lib/format";

const FILTERS = ["All", "Overdue", "Due 7 days", "Pending", "Filed"] as const;
type Filter = (typeof FILTERS)[number];

const TASK_TYPES = [
  "GST Filing (GSTR-1)", "GST Filing (GSTR-3B)", "GST Filing (GSTR-9)", "TDS Payment (26Q)",
  "TDS Return (24Q)", "ITR Filing", "Tax Audit Report", "ROC Annual Filing (AOC-4)",
  "ROC Annual Filing (MGT-7)", "Trust Audit", "Statutory Audit",
];

function monthLabel(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function suggestedDueDate(type: string): string {
  const day = type.includes("GSTR-1") || type.includes("26Q") ? 11 : type.includes("GSTR-3B") ? 20 : type.includes("24Q") ? 31 : 30;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const candidate = new Date(now.getFullYear(), now.getMonth(), day);
  if (candidate < now) candidate.setMonth(candidate.getMonth() + 1);
  return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
}

export function ComplianceView({ compliance, clients, firmName }: { compliance: Compliance[]; clients: Client[]; firmName: string }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [recurringOpen, setRecurringOpen] = React.useState(false);
  const [selectedClients, setSelectedClients] = React.useState<string[]>(clients.map((c) => c.client_id));
  const [firmBusy, setFirmBusy] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();

  const [form, setForm] = React.useState({
    client_id: clients[0]?.client_id ?? "",
    compliance_type: TASK_TYPES[1],
    period: monthLabel(-1),
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    assigned_to: "",
    notes: "",
  });

  const [recurring, setRecurring] = React.useState({
    compliance_type: TASK_TYPES[1],
    period: monthLabel(-1),
    due_date: suggestedDueDate(TASK_TYPES[1]),
    assigned_to: "",
  });

  const clientByName = React.useMemo(() => new Map(clients.map((c) => [c.name, c])), [clients]);

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return compliance.filter((c) => {
      const matchesFilter =
        filter === "All" ||
        (filter === "Overdue" && c.status === "Overdue") ||
        (filter === "Due 7 days" && c.status !== "Filed" && dayDiff(c.due_date) >= 0 && dayDiff(c.due_date) <= 7) ||
        (filter === "Pending" && c.status === "Pending") ||
        (filter === "Filed" && c.status === "Filed");
      const matchesQuery = !q || [c.client_name, c.compliance_type, c.period, c.assigned_to].join(" ").toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [compliance, filter, query]);

  const open = compliance.filter((c) => c.status !== "Filed");
  const overdue = compliance.filter((c) => c.status === "Overdue").length;
  const dueWeek = open.filter((c) => dayDiff(c.due_date) >= 0 && dayDiff(c.due_date) <= 7).length;
  const filed = compliance.filter((c) => c.status === "Filed").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Compliance>("/api/compliance", "POST", form, "Compliance task created");
    if (created) setAddOpen(false);
  }

  async function markFiled(item: Compliance) {
    await mutate<Compliance>(`/api/compliance/${item.compliance_id}`, "PATCH", { status: "Filed" }, `${item.compliance_type} marked filed`);
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (selectedClients.length === 0) {
      toast("Select at least one client", "error");
      return;
    }
    setFirmBusy(true);
    try {
      const res = await fetch("/api/compliance/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...recurring, client_ids: selectedClients }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not generate tasks");
      toast(`${data.created ?? 0} task(s) created${data.skipped ? ` · ${data.skipped} skipped (already exist)` : ""}`);
      setRecurringOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not generate tasks", "error");
    } finally {
      setFirmBusy(false);
    }
  }

  function toggleClient(id: string) {
    setSelectedClients((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Statutory desk"
        title="Compliance calendar"
        description="Every GST, TDS, ROC and audit deadline, ranked by urgency."
      >
        <AiAssist task="week_plan" label="Plan my week" />
        <Button variant="secondary" onClick={() => setRecurringOpen(true)}>
          <Repeat className="h-4 w-4" /> Recurring run
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New task
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Open tasks" value={open.length} icon={<CalendarCheck2 className="h-4 w-4" />} />
        <MiniStat label="Due this week" value={dueWeek} icon={<BellRing className="h-4 w-4" />} tone="gold" />
        <MiniStat label="Overdue" value={overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="rose" />
        <MiniStat label="Filed" value={filed} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <SectionCard
        title={`${filtered.length} tasks`}
        subtitle="Mark filed to record the acknowledgement number automatically"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search tasks…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No tasks in this view" description="Change the filter or create a new compliance task." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Client</Th>
                  <Th>Task</Th>
                  <Th>Period</Th>
                  <Th>Due date</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const days = dayDiff(c.due_date);
                  const client = clientByName.get(c.client_name);
                  const contact = client?.contact_person || c.client_name;
                  return (
                    <tr key={c.compliance_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.client_name} />
                          <div>
                            <p className="text-xs font-semibold text-ink">{c.client_name}</p>
                            <p className="text-[10px] text-muted">{c.assigned_to || "Unassigned"}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <p className="text-xs font-semibold text-ink">{c.compliance_type}</p>
                        <p className="text-[10px] text-muted">{c.compliance_id}</p>
                      </Td>
                      <Td><span className="text-[11px] text-muted">{c.period}</span></Td>
                      <Td>
                        <p className="text-xs font-semibold text-ink">{prettyDate(c.due_date)}</p>
                        <p className={`text-[10px] ${c.status === "Filed" ? "text-muted" : days < 0 ? "text-[#A33B2E]" : days <= 7 ? "text-[#8A6420]" : "text-muted"}`}>
                          {c.status === "Filed" ? `Filed ${prettyDate(c.filed_date)}` : relativeDeadline(c.due_date)}
                        </p>
                      </Td>
                      <Td><StatusPill status={c.status} /></Td>
                      <Td className="text-right">
                        {c.status === "Filed" ? (
                          <Badge tone="green">{c.ack_number || "Filed"}</Badge>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <ReminderButton
                              recipient={c.client_name}
                              phone={client?.phone}
                              email={client?.email}
                              subject={`${c.compliance_type} — ${c.period}`}
                              relatedType="compliance"
                              relatedId={c.compliance_id}
                              message={`Dear ${contact},\n\nThis is a reminder that ${c.compliance_type} for ${c.period} is due on ${prettyDate(c.due_date)} and is currently ${c.status.toLowerCase()}. Please share the pending details so we can file on time.\n\nRegards,\n${firmName}`}
                            />
                            <Button size="sm" variant="soft" onClick={() => markFiled(c)} loading={busy}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Mark filed
                            </Button>
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New compliance task" description="Add a statutory filing with its due date.">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client" className="sm:col-span-2">
              <select required className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Task type" className="sm:col-span-2">
              <select className="input" value={form.compliance_type} onChange={(e) => setForm({ ...form, compliance_type: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Period"><input className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Sep 2026 / Q2 FY26" /></Field>
            <Field label="Due date"><input required type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Assigned to"><input className="input" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} placeholder="Ananya Iyer" /></Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create task</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        title="Generate recurring tasks"
        description="Create the same filing for many clients at once — existing client/type/period combinations are skipped."
        wide
      >
        <form onSubmit={generate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Task type">
              <select
                className="input"
                value={recurring.compliance_type}
                onChange={(e) => setRecurring({ ...recurring, compliance_type: e.target.value, due_date: suggestedDueDate(e.target.value) })}
              >
                {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Period">
              <input className="input" value={recurring.period} onChange={(e) => setRecurring({ ...recurring, period: e.target.value })} />
            </Field>
            <Field label="Due date">
              <input required type="date" className="input" value={recurring.due_date} onChange={(e) => setRecurring({ ...recurring, due_date: e.target.value })} />
            </Field>
            <Field label="Assigned to">
              <input className="input" value={recurring.assigned_to} onChange={(e) => setRecurring({ ...recurring, assigned_to: e.target.value })} placeholder="Ananya Iyer" />
            </Field>
          </div>

          <div className="rounded-2xl border border-black/5">
            <div className="flex items-center justify-between border-b border-black/5 px-3 py-2">
              <p className="text-[11px] font-bold text-ink">{selectedClients.length} of {clients.length} clients selected</p>
              <div className="flex gap-2 text-[10px] font-bold">
                <button type="button" className="text-green hover:underline" onClick={() => setSelectedClients(clients.map((c) => c.client_id))}>Select all</button>
                <button type="button" className="text-muted hover:underline" onClick={() => setSelectedClients([])}>Clear</button>
              </div>
            </div>
            <div className="grid max-h-52 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
              {clients.map((c) => (
                <label key={c.client_id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[11px] hover:bg-subtle">
                  <input
                    type="checkbox"
                    checked={selectedClients.includes(c.client_id)}
                    onChange={() => toggleClient(c.client_id)}
                    className="h-3.5 w-3.5 accent-[#3B5244]"
                  />
                  <span className="truncate text-ink">{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="rounded-xl bg-gold-soft/60 px-3 py-2 text-[10px] leading-relaxed text-muted">
            {recurring.compliance_type} · {recurring.period} · due {prettyDate(recurring.due_date)} — {selectedClients.length} task(s) will be attempted.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setRecurringOpen(false)}>Cancel</Button>
            <Button type="submit" loading={firmBusy} disabled={selectedClients.length === 0}>
              <Repeat className="h-4 w-4" /> Generate {selectedClients.length} task(s)
            </Button>
          </div>
        </form>
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
