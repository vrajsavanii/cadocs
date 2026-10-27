"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CheckCheck, Download, FileCheck2, FileClock, Flag, FolderOpen, History, Paperclip, Plus, Send, Tag, Sparkles } from "lucide-react";
import type { Client, DocumentItem, DocumentRequest } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { prettyDate } from "@/lib/format";

const FILTERS = ["All", "Pending", "Received", "Rejected", "Verified"] as const;
type Filter = (typeof FILTERS)[number];

type VersionRow = {
  version: number;
  file_name: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
  status: string;
  change_reason: string;
};

export function DocumentsView({
  documents,
  clients,
  firmName,
  requests = [],
  role = "article",
}: {
  documents: DocumentItem[];
  clients: Client[];
  firmName: string;
  requests?: DocumentRequest[];
  role?: string;
}) {
  const canReview = role === "partner" || role === "manager";
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [rejectFor, setRejectFor] = React.useState<DocumentItem | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [historyFor, setHistoryFor] = React.useState<DocumentItem | null>(null);
  const [versions, setVersions] = React.useState<VersionRow[] | null>(null);
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
  const [chasing, setChasing] = React.useState<string | null>(null);

  async function chasePacket(request: DocumentRequest) {
    setChasing(request.request_id);
    try {
      const res = await fetch(`/api/document-requests/${request.request_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chase" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) throw new Error(data.error || "Could not prepare the message");
      toast(data.status === "sent" ? "Sent on WhatsApp" : "Message added to the outbox");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not prepare the message", "error");
    } finally {
      setChasing(null);
    }
  }

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

  async function updateStatus(doc: DocumentItem, status: DocumentItem["status"], reason = "") {
    const success = await mutate<DocumentItem>(
      `/api/documents/${doc.doc_id}`,
      "PATCH",
      { action: "status", status, reason },
      status === "Received" ? "Marked received" : `Marked ${status.toLowerCase()}`,
    );
    if (status === "Rejected" && success) {
      setRejectFor(null);
      setRejectReason("");
    }
  }

  async function archive(doc: DocumentItem) {
    await mutate<DocumentItem>(`/api/documents/${doc.doc_id}`, "PATCH", { action: "archive" }, "Archived — bytes retained");
  }

  async function loadHistory(doc: DocumentItem) {
    setHistoryFor(doc);
    setVersions(null);
    try {
      const res = await fetch(`/api/documents/${doc.doc_id}/versions`);
      const data = (await res.json().catch(() => ({}))) as { versions?: VersionRow[] };
      setVersions(data.versions ?? []);
    } catch {
      setVersions([]);
    }
  }

  async function classify(doc: DocumentItem) {
    await mutate<DocumentItem>(
      `/api/documents/${doc.doc_id}`,
      "PATCH",
      { action: "classify", needs_classification: true },
      "Flagged as needs classification",
    );
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
        <Link href="/folders" className="inline-flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-subtle">
          <FolderOpen className="h-4 w-4" /> Client folders
        </Link>
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
                  <Th>Packet</Th>
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
                      <p className="text-[10px] text-muted">{d.doc_id} · {d.category || "General"} · {d.period || d.fy || "Unfiled"}</p>
                      {d.needs_classification ? (
                        <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-gold-soft/70 px-2 py-0.5 text-[9px] font-bold text-gold"><Tag className="h-2.5 w-2.5" /> Needs classification</p>
                      ) : null}
                      {d.file_name ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-green">
                          <Paperclip className="h-2.5 w-2.5" />
                          <span className="max-w-[160px] truncate">{d.file_name}</span>
                          <span className="text-muted">{sizeLabel(d.file_size)}</span>
                        </p>
                      ) : null}
                      {d.status === "Rejected" && d.review_reason ? (
                        <p className="mt-0.5 max-w-[240px] text-[10px] font-semibold text-[#A33B2E]">Rejected: {d.review_reason}</p>
                      ) : d.status === "Verified" && d.verified_by ? (
                        <p className="mt-0.5 text-[10px] text-muted">Verified by {d.verified_by}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={d.client_name} className="h-7 w-7 text-[9px]" />
                        <span className="text-xs text-ink">{d.client_name}</span>
                      </div>
                    </Td>
                    <Td>
                      {(() => {
                        const request = requests.find((r) => r.request_id === d.request_id);
                        if (!request) return <span className="text-[10px] text-muted">Manual / unfiled</span>;
                        return (
                          <div>
                            <p className="text-[10px] font-semibold text-ink">{request.period}</p>
                            <p className="flex items-center gap-1 text-[9px] text-muted">
                              <BellRing className="h-2.5 w-2.5" /> {request.reminders_sent}/{request.reminder_cap} reminders
                            </p>
                            <span className="mt-1 flex gap-0.5">
                              {Array.from({ length: request.reminder_cap }).map((_, index) => (
                                <span key={index} className={`h-1 w-2.5 rounded-full ${index < request.reminders_sent ? "bg-gold" : "bg-black/10"}`} />
                              ))}
                            </span>
                          </div>
                        );
                      })()}
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
                        <button
                          type="button"
                          onClick={() => void loadHistory(d)}
                          title="Version history"
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
                        >
                          <History className="h-3.5 w-3.5" /> Versions
                        </button>
                        {canReview ? (
                          <button
                            type="button"
                            onClick={() => void classify(d)}
                            title="Cannot confidently classify it yet"
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
                          >
                            <Tag className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {d.status === "Pending" ? (
                          <>
                            {(() => {
                              const request = requests.find((r) => r.request_id === d.request_id);
                              if (request) {
                                const capped = request.reminders_sent >= request.reminder_cap;
                                return (
                                  <Button size="sm" variant="secondary" loading={chasing === request.request_id} disabled={capped} onClick={() => void chasePacket(request)}>
                                    {capped ? "Cap reached" : <><Send className="h-3 w-3" /> Chase packet</>}
                                  </Button>
                                );
                              }
                              const client = clients.find((c) => c.client_id === d.client_id);
                              return (
                                <ReminderButton
                                  recipient={d.client_name}
                                  phone={client?.phone}
                                  email={client?.email}
                                  subject={`${d.document_name} pending`}
                                  relatedType="document"
                                  relatedId={d.doc_id}
                                  label="Chase"
                                  message={`Dear ${client?.contact_person || d.client_name},\n\nWe are waiting on \"${d.document_name}\" to complete your filing. It was requested on ${prettyDate(d.requested_date)}.\n\nKindly share it at the earliest.\n\nRegards,\n${firmName}`}
                                />
                              );
                            })()}
                            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                              <Paperclip className="h-3.5 w-3.5" /> Upload
                              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                            </label>
                            <Button size="sm" variant="soft" onClick={() => updateStatus(d, "Received")} loading={busy}>Mark received</Button>
                          </>
                        ) : d.status === "Received" ? (
                          <>
                            {canReview ? (
                              <>
                                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                                  <Paperclip className="h-3.5 w-3.5" /> {d.file_name ? "Replace" : "Upload"}
                                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                                </label>
                                <Button size="sm" variant="soft" onClick={() => updateStatus(d, "Verified")} loading={busy}>Verify</Button>
                                <Button size="sm" variant="ghost" onClick={() => setRejectFor(d)}>
                                  <Flag className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </>
                            ) : (
                              <Badge tone="blue">Awaiting review</Badge>
                            )}
                          </>
                        ) : d.status === "Rejected" && canReview ? (
                          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                            <Paperclip className="h-3.5 w-3.5" /> Replacement
                            <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                        ) : (
                          <>
                            {canReview ? (
                              <Button size="sm" variant="ghost" onClick={() => void archive(d)}>Archive</Button>
                            ) : null}
                            <Badge tone="green">Closed</Badge>
                          </>
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

      <Modal open={rejectFor !== null} onClose={() => setRejectFor(null)} title={`Reject — ${rejectFor?.document_name ?? ""}`} description="The client cannot fix an unexplained rejection. Write what needs to change.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!rejectFor) return;
            void updateStatus(rejectFor, "Rejected", rejectReason);
          }}
          className="space-y-3"
        >
          <Field label="Reason (required)">
            <textarea required minLength={3} className="input min-h-[80px]" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Amounts do not match the ledger; please re-export from the bank portal." />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button type="submit" loading={busy}><Flag className="h-4 w-4" /> Reject document</Button>
          </div>
        </form>
      </Modal>

      <Modal open={historyFor !== null} onClose={() => setHistoryFor(null)} title={`Versions — ${historyFor?.document_name ?? ""}`} description="Every upload is kept. Older versions stay downloadable from the file link with ?version=n.">
        {!versions ? (
          <p className="py-4 text-sm text-muted">Loading versions…</p>
        ) : versions.length === 0 ? (
          <p className="py-4 text-sm text-muted">No versions uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center justify-between gap-2 rounded-xl border border-black/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink">v{v.version} · {v.file_name}</p>
                  <p className="text-[10px] text-muted">
                    {v.uploaded_by ? `${v.uploaded_by} · ` : ""}{prettyDate(v.uploaded_at.slice(0, 10))}
                    {v.change_reason ? ` · ${v.change_reason}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={v.status === "current" ? "green" : "neutral"}>{v.status}</Badge>
                  <a href={`/api/documents/${historyFor?.doc_id}/file?version=${v.version}`} className="inline-flex h-7 items-center gap-1 rounded-full border border-black/10 bg-white px-2 text-[9px] font-bold text-ink hover:bg-subtle">
                    <Download className="h-2.5 w-2.5" /> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
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
