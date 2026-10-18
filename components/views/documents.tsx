"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Download, FileCheck2, FileClock, FolderOpen, Paperclip, Plus, Sparkles } from "lucide-react";
import type { Client, DocumentItem } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { prettyDate } from "@/lib/format";

const FILTERS = ["All", "Pending", "Received", "Verified"] as const;
type Filter = (typeof FILTERS)[number];

export function DocumentsView({ documents, clients, firmName }: { documents: DocumentItem[]; clients: Client[]; firmName: string }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = React.useState({
    client_id: clients[0]?.client_id ?? "",
    document_name: "",
    notes: "",
  });
  const [classifyBusy, setClassifyBusy] = React.useState(false);
  const [classifyHint, setClassifyHint] = React.useState("");

  async function suggestName() {
    if (form.document_name.trim().length < 3) return;
    setClassifyBusy(true);
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.document_name, notes: form.notes }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        category?: string; suggested_name?: string; source?: string; error?: string;
      };
      if (!res.ok) {
        toast(data.error || "Could not classify the document", "error");
        return;
      }
      if (data.suggested_name) setForm({ ...form, document_name: data.suggested_name });
      setClassifyHint(
        `${data.category ?? "General"} · ${data.source && data.source !== "rules" ? data.source : "keyword rules"}`,
      );
    } catch {
      toast("The classifier is unreachable", "error");
    } finally {
      setClassifyBusy(false);
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return documents.filter((d) => {
      const matchesFilter = filter === "All" || d.status === filter;
      const matchesQuery = !q || [d.document_name, d.client_name].join(" ").toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [documents, filter, query]);

  const pending = documents.filter((d) => d.status === "Pending").length;
  const received = documents.filter((d) => d.status === "Received").length;
  const verified = documents.filter((d) => d.status === "Verified").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<DocumentItem>("/api/documents", "POST", form, "Document requested");
    if (created) {
      setAddOpen(false);
      setForm({ ...form, document_name: "", notes: "" });
    }
  }

  async function updateStatus(doc: DocumentItem, status: DocumentItem["status"]) {
    await mutate<DocumentItem>(`/api/documents/${doc.doc_id}`, "PATCH", { status }, status === "Received" ? "Marked received" : `Marked ${status.toLowerCase()}`);
  }

  async function upload(doc: DocumentItem, file: File | undefined) {
    if (!file) return;
    const payload = new FormData();
    payload.append("file", file);
    const res = await fetch(`/api/documents/${doc.doc_id}/file`, { method: "POST", body: payload });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast(data.error || "Upload failed", "error");
      return;
    }
    toast(`${file.name} attached`);
    router.refresh();
  }

  function sizeLabel(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Client collaboration"
        title="Document tracker"
        description="Chase, receive and verify client documents without email archaeology."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Request document
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Pending" value={pending} icon={<FileClock className="h-4 w-4" />} tone="rose" />
        <MiniStat label="Received" value={received} icon={<FolderOpen className="h-4 w-4" />} />
        <MiniStat label="Verified" value={verified} icon={<FileCheck2 className="h-4 w-4" />} />
        <MiniStat label="Total tracked" value={documents.length} icon={<CheckCheck className="h-4 w-4" />} />
      </div>

      <SectionCard
        title={`${filtered.length} documents`}
        subtitle="Pending items are surfaced on the dashboard and chase list"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search documents…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No documents in this view" description="Request a document to start the chase list." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Document</Th>
                  <Th>Client</Th>
                  <Th>Requested</Th>
                  <Th>Received</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.doc_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                    <Td>
                      <p className="text-xs font-semibold text-ink">{d.document_name}</p>
                      <p className="text-[10px] text-muted">{d.doc_id}</p>
                      {d.file_name ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-green">
                          <Paperclip className="h-2.5 w-2.5" />
                          <span className="max-w-[160px] truncate">{d.file_name}</span>
                          <span className="text-muted">{sizeLabel(d.file_size)}</span>
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={d.client_name} className="h-7 w-7 text-[9px]" />
                        <span className="text-xs text-ink">{d.client_name}</span>
                      </div>
                    </Td>
                    <Td><span className="text-[11px] text-muted">{prettyDate(d.requested_date)}</span></Td>
                    <Td><span className="text-[11px] text-muted">{d.received_date ? prettyDate(d.received_date) : "—"}</span></Td>
                    <Td><StatusPill status={d.status} /></Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {d.file_name ? (
                          <a
                            href={`/api/documents/${d.doc_id}/file`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
                          >
                            <Download className="h-3.5 w-3.5" /> File
                          </a>
                        ) : null}
                        {d.status === "Pending" ? (
                          <>
                            <ReminderButton
                              recipient={d.client_name}
                              phone={clients.find((c) => c.name === d.client_name)?.phone}
                              email={clients.find((c) => c.name === d.client_name)?.email}
                              subject={`${d.document_name} pending`}
                              relatedType="document"
                              relatedId={d.doc_id}
                              label="Chase"
                              message={`Dear ${clients.find((c) => c.name === d.client_name)?.contact_person || d.client_name},\n\nWe are waiting on \"${d.document_name}\" to complete your filing. It was requested on ${prettyDate(d.requested_date)}.\n\nKindly share it at the earliest.\n\nRegards,\n${firmName}`}
                            />
                            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                              <Paperclip className="h-3.5 w-3.5" /> Upload
                              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                            </label>
                            <Button size="sm" variant="soft" onClick={() => updateStatus(d, "Received")} loading={busy}>Mark received</Button>
                          </>
                        ) : d.status === "Received" ? (
                          <>
                            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                              <Paperclip className="h-3.5 w-3.5" /> {d.file_name ? "Replace" : "Upload"}
                              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                            </label>
                            <Button size="sm" variant="soft" onClick={() => updateStatus(d, "Verified")} loading={busy}>Verify</Button>
                          </>
                        ) : (
                          <Badge tone="green">Closed</Badge>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Request a document" description="Adds the item to the pending chase list for this client.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Client">
            <select required className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Document name">
            <input required className="input" value={form.document_name} onChange={(e) => setForm({ ...form, document_name: e.target.value })} placeholder="Bank statement — Oct 2026" />
          </Field>
          <div className="flex items-center justify-between gap-2 -mt-1">
            <button
              type="button"
              onClick={() => void suggestName()}
              disabled={classifyBusy || form.document_name.trim().length < 3}
              className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft/70 px-3 py-1.5 text-[11px] font-bold text-gold transition hover:bg-gold-soft disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" /> {classifyBusy ? "Classifying…" : "Suggest name & type"}
            </button>
            {classifyHint ? <span className="text-[10px] font-semibold text-muted">{classifyHint}</span> : null}
          </div>
          <Field label="Notes">
            <textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Period, format, portal…" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Request</Button>
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
