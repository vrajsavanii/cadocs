"use client";

import * as React from "react";
import { Check, Clock3, Plus, Timer, X } from "lucide-react";
import type { Timesheet } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal } from "../interactive";
import { FilterTabs, SearchBox, SectionCard, useMutation } from "./shared";
import { prettyDate } from "@/lib/format";

const FILTERS = ["All", "Pending", "Approved", "Rejected"] as const;
type Filter = (typeof FILTERS)[number];

export function TimesheetsView({ entries, clients }: { entries: Timesheet[]; clients: string[] }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const { busy, mutate } = useMutation();
  const [form, setForm] = React.useState({
    user_name: "",
    client_name: clients[0] ?? "",
    date: new Date().toISOString().slice(0, 10),
    task_type: "GST Filing",
    description: "",
    hours: 2,
    billable: true,
  });

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return entries.filter((t) => {
      const matchesFilter = filter === "All" || t.status === filter;
      const matchesQuery = !q || [t.user_name, t.client_name, t.task_type, t.description].join(" ").toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [entries, filter, query]);

  const weekStart = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }, []);
  const thisWeek = entries.filter((t) => new Date(`${t.date}T00:00:00`) >= weekStart);
  const weekHours = thisWeek.reduce((s, t) => s + t.hours, 0);
  const billableHours = thisWeek.filter((t) => t.billable).reduce((s, t) => s + t.hours, 0);
  const pending = entries.filter((t) => t.status === "Pending").length;
  const staff = Array.from(new Set(entries.map((t) => t.user_name))).length;
  const billablePct = weekHours > 0 ? Math.round((billableHours / weekHours) * 100) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Timesheet>("/api/timesheets", "POST", form, "Time logged");
    if (created) {
      setAddOpen(false);
      setForm({ ...form, description: "", hours: 2 });
    }
  }

  async function decide(entry: Timesheet, status: Timesheet["status"]) {
    await mutate<Timesheet>(`/api/timesheets/${entry.timesheet_id}`, "PATCH", { status }, `Entry ${status.toLowerCase()}`);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Team operations"
        title="Staff timesheets"
        description="Billable hours, utilisation and approvals for the whole team."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Log time
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Hours this week" value={`${weekHours.toFixed(1)}h`} icon={<Clock3 className="h-4 w-4" />} />
        <Metric label="Billable share" value={`${billablePct}%`} icon={<Timer className="h-4 w-4" />} />
        <Metric label="Awaiting approval" value={String(pending)} icon={<span className="text-xs font-extrabold">!</span>} tone="gold" />
        <Metric label="Team members" value={String(staff)} icon={<span className="text-xs font-extrabold">#</span>} />
      </div>

      <SectionCard
        title={`${filtered.length} entries`}
        subtitle="Approve billable time to lock it into client WIP"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search entries…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<Clock3 className="h-5 w-5" />} title="No timesheet entries" description="Log time against a client to start utilisation tracking." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Staff</Th>
                  <Th>Client</Th>
                  <Th>Date</Th>
                  <Th>Task</Th>
                  <Th className="text-right">Hours</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.timesheet_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={t.user_name} className="h-7 w-7 text-[9px]" />
                        <span className="text-xs font-semibold text-ink">{t.user_name}</span>
                      </div>
                    </Td>
                    <Td><span className="text-xs text-ink">{t.client_name}</span></Td>
                    <Td><span className="text-[11px] text-muted">{prettyDate(t.date)}</span></Td>
                    <Td>
                      <p className="text-xs text-ink">{t.task_type}</p>
                      <p className="max-w-[220px] truncate text-[10px] text-muted">{t.description}</p>
                    </Td>
                    <Td className="text-right"><span className="text-xs font-extrabold text-ink">{t.hours.toFixed(2)}</span></Td>
                    <Td><Badge tone={t.billable ? "green" : "neutral"}>{t.billable ? "Billable" : "Non-billable"}</Badge></Td>
                    <Td><StatusPill status={t.status} /></Td>
                    <Td className="text-right">
                      {t.status === "Pending" ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="text-[#A33B2E]" onClick={() => decide(t, "Rejected")} aria-label="Reject"><X className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="soft" onClick={() => decide(t, "Approved")} loading={busy}><Check className="h-3.5 w-3.5" /> Approve</Button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{t.status}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Log time" description="Entries start as pending until a partner approves them.">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Staff member">
              <input required className="input" value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} placeholder="Ananya Iyer" />
            </Field>
            <Field label="Client">
              <select className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}>
                {clients.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Task type">
              <select className="input" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value })}>
                {["GST Filing", "ITR Filing", "Tax Audit", "Statutory Audit", "ROC Compliance", "Notice Representation", "TDS Filing", "Advisory"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Hours">
              <input required type="number" min={0.25} max={24} step={0.25} className="input" value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
            </Field>
            <Field label="Billable">
              <select className="input" value={form.billable ? "Yes" : "No"} onChange={(e) => setForm({ ...form, billable: e.target.value === "Yes" })}>
                <option>Yes</option><option>No</option>
              </select>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="GSTR-3B reconciliation for September" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Log entry</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Metric({ label, value, icon, tone = "sage" }: { label: string; value: string; icon: React.ReactNode; tone?: "sage" | "gold" }) {
  const tones = { sage: "bg-sage text-sage-ink", gold: "bg-gold-soft text-gold" };
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
