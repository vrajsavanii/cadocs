"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  Download,
  FolderClosed,
  FolderOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Upload,
  Users,
} from "lucide-react";
import type { Client, ClientService, DocumentItem, DocumentRequest } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill } from "../ui";
import { Modal, useToast } from "../interactive";
import { prettyDate } from "@/lib/format";
import { getService } from "@/lib/services";

type FolderGroup = {
  fy: string;
  request: DocumentRequest | null;
  serviceCode: string;
  period: string;
  docs: DocumentItem[];
};

export function FoldersView({
  clients,
  documents,
  requests,
  services,
}: {
  clients: Client[];
  documents: DocumentItem[];
  requests: DocumentRequest[];
  services: ClientService[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string>(() => {
    const withPending = clients.find((client) => documents.some((doc) => doc.client_id === client.client_id && doc.status === "Pending"));
    return withPending?.client_id ?? clients[0]?.client_id ?? "";
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [serviceCode, setServiceCode] = React.useState("");

  const filteredClients = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return clients.filter((client) => !q || [client.name, client.pan, client.gst_number, client.city].join(" ").toLowerCase().includes(q));
  }, [clients, query]);

  const client = clients.find((c) => c.client_id === selectedId) ?? filteredClients[0] ?? null;
  const clientDocs = React.useMemo(() => documents.filter((doc) => doc.client_id === client?.client_id), [documents, client]);
  const clientRequests = React.useMemo(() => requests.filter((request) => request.client_id === client?.client_id), [requests, client]);
  const clientServices = services.filter((service) => service.client_id === client?.client_id);

  React.useEffect(() => {
    if (!client && filteredClients[0]) setSelectedId(filteredClients[0].client_id);
  }, [client, filteredClients]);

  const groups = React.useMemo<FolderGroup[]>(() => {
    const list: FolderGroup[] = clientRequests.map((request) => ({
      fy: request.fy || "Unfiled",
      request,
      serviceCode: request.service_code,
      period: request.period,
      docs: clientDocs.filter((doc) => doc.request_id === request.request_id),
    }));
    const linked = new Set(clientRequests.map((r) => r.request_id));
    const orphan = clientDocs.filter((doc) => !doc.request_id || !linked.has(doc.request_id));
    const orphanByFolder = new Map<string, DocumentItem[]>();
    orphan.forEach((doc) => {
      const key = `${doc.fy || "Unfiled"}|${doc.service_code || "other"}|${doc.period || "Manual"}`;
      orphanByFolder.set(key, [...(orphanByFolder.get(key) ?? []), doc]);
    });
    for (const [key, docs] of orphanByFolder) {
      const [fy, code, period] = key.split("|");
      list.push({ fy: fy || "Unfiled", request: null, serviceCode: code || "other", period: period || "Manual", docs });
    }
    return list.sort((a, b) => b.fy.localeCompare(a.fy) || b.period.localeCompare(a.period));
  }, [clientDocs, clientRequests]);

  const byFy = React.useMemo(() => {
    const map = new Map<string, FolderGroup[]>();
    groups.forEach((group) => map.set(group.fy, [...(map.get(group.fy) ?? []), group]));
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [groups]);

  async function chase(request: DocumentRequest) {
    setBusy(request.request_id);
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
      setBusy(null);
    }
  }

  async function setDocStatus(doc: DocumentItem, status: DocumentItem["status"]) {
    setBusy(doc.doc_id);
    try {
      const res = await fetch(`/api/documents/${doc.doc_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update the document");
      toast(`${doc.document_name} ${status.toLowerCase()}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update the document", "error");
    } finally {
      setBusy(null);
    }
  }

  async function upload(doc: DocumentItem, file: File | undefined) {
    if (!file) return;
    setBusy(doc.doc_id);
    const payload = new FormData();
    payload.append("file", file);
    try {
      const res = await fetch(`/api/documents/${doc.doc_id}/file`, { method: "POST", body: payload });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast(`${file.name} filed`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function requestPacket(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy("new");
    try {
      const res = await fetch("/api/document-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.client_id, service_code: serviceCode, send: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; period?: string };
      if (!res.ok) throw new Error(data.error || "Could not open the period");
      toast(`${data.period ?? "Period"} packet ready — ${data.message ?? "request queued"}`);
      setRequestOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not open the period", "error");
    } finally {
      setBusy(null);
    }
  }

  const pending = clientDocs.filter((doc) => doc.status === "Pending").length;

  return (
    <div>
      <PageHeader
        eyebrow="Client documents"
        title="Client folders"
        description="Client → financial year → service period → category. Every request, file and reminder in one place."
      >
        <Button onClick={() => { setServiceCode(clientServices[0]?.service_code ?? "gstr3b"); setRequestOpen(true); }} disabled={!client || clientServices.length === 0}>
          <Plus className="h-4 w-4" /> Request a period
        </Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Clients" value={clients.length} icon={<Users className="h-4 w-4" />} />
        <Mini label="Folders" value={groups.length} icon={<FolderOpen className="h-4 w-4" />} hint={client?.name ?? "Select a client"} />
        <Mini label="Pending papers" value={documents.filter((doc) => doc.status === "Pending").length} icon={<Paperclip className="h-4 w-4" />} tone="rose" />
        <Mini label="Cleared packets" value={requests.filter((r) => r.status === "Cleared").length} icon={<FolderClosed className="h-4 w-4" />} tone="green" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <div className="card h-fit p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a client…"
              className="h-9 w-full rounded-full border border-black/10 bg-white pl-9 pr-3 text-xs outline-none placeholder:text-muted/70 focus:border-green/40"
            />
          </div>
          <div className="max-h-[520px] space-y-1 overflow-y-auto pr-0.5">
            {filteredClients.map((item) => {
              const itemPending = documents.filter((doc) => doc.client_id === item.client_id && doc.status === "Pending").length;
              return (
                <button
                  key={item.client_id}
                  onClick={() => setSelectedId(item.client_id)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${client?.client_id === item.client_id ? "bg-sage" : "hover:bg-subtle"}`}
                >
                  <Avatar name={item.name} className="h-7 w-7 text-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-ink">{item.name}</span>
                    <span className="block text-[9px] text-muted">{item.client_id} · {item.entity_type}</span>
                  </span>
                  {itemPending > 0 ? <span className="rounded-full bg-[#FBEAE7] px-1.5 py-0.5 text-[9px] font-bold text-[#A33B2E]">{itemPending}</span> : null}
                </button>
              );
            })}
            {filteredClients.length === 0 ? <p className="px-2 py-6 text-center text-[11px] text-muted">No client matches.</p> : null}
          </div>
        </div>

        <div className="space-y-3">
          {!client ? (
            <div className="card"><EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No client selected" description="Onboard a client to start a folder." /></div>
          ) : (
            <>
              <div className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={client.name} className="h-11 w-11 text-xs" />
                    <div>
                      <p className="text-base font-extrabold text-ink">{client.name}</p>
                      <p className="text-[11px] text-muted">{client.client_id} · {client.entity_type} · {[client.city, client.state].filter(Boolean).join(", ") || "India"}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {clientServices.map((service) => <Badge key={service.service_id} tone="sage">{getService(service.service_code).short}</Badge>)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Open folder</p>
                    <p className="text-sm font-extrabold text-ink">{pending} pending</p>
                    <p className="text-[10px] text-muted">{clientDocs.length} papers on file</p>
                  </div>
                </div>
              </div>

              {byFy.length === 0 ? (
                <div className="card"><EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No folder yet" description="Open the current period to create a request packet and its checklist." action={<Button variant="secondary" onClick={() => setRequestOpen(true)}>Request a period</Button>} /></div>
              ) : (
                byFy.map(([fy, folderGroups]) => (
                  <details key={fy} open className="card overflow-hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
                      <span className="flex items-center gap-2">
                        <ChevronDown className="h-4 w-4 text-muted" />
                        <FolderOpen className="h-4 w-4 text-green" />
                        <span className="text-sm font-extrabold text-ink">FY {fy === "Unfiled" ? "Unfiled" : fy}</span>
                        <Badge tone="neutral">{folderGroups.length} period{folderGroups.length === 1 ? "" : "s"}</Badge>
                      </span>
                      <span className="text-[10px] text-muted">
                        {folderGroups.reduce((sum, group) => sum + group.docs.filter((d) => d.status === "Pending").length, 0)} pending
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-black/5 p-3">
                      {folderGroups.map((group) => {
                        const defined = getService(group.serviceCode);
                        const request = group.request;
                        const pendingDocs = group.docs.filter((doc) => doc.status === "Pending" || doc.status === "Rejected").length;
                        const capped = request ? request.reminders_sent >= request.reminder_cap : false;
                        const categories = new Map<string, DocumentItem[]>();
                        group.docs.forEach((doc) => categories.set(doc.category || "General", [...(categories.get(doc.category || "General") ?? []), doc]));
                        return (
                          <div key={request?.request_id ?? `${group.serviceCode}-${group.period}`} className="rounded-2xl border border-black/5">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-3 py-2.5">
                              <div>
                                <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink">
                                  {defined.short} · {group.period}
                                  {request ? <Badge tone={request.status === "Open" ? "amber" : "green"}>{request.status}</Badge> : <Badge tone="neutral">Manual</Badge>}
                                </p>
                                <p className="text-[10px] text-muted">
                                  {group.docs.length} items · {pendingDocs} pending
                                  {request ? ` · reminders ${request.reminders_sent}/${request.reminder_cap}` : ""}
                                  {request?.next_reminder_on && request.status === "Open" ? ` · next ${prettyDate(request.next_reminder_on)}` : ""}
                                </p>
                              </div>
                              {request && request.status === "Open" && pendingDocs > 0 ? (
                                <Button size="sm" variant="secondary" loading={busy === request.request_id} disabled={capped} onClick={() => void chase(request)}>
                                  {capped ? <><BellRing className="h-3 w-3" /> Cap reached</> : <><Send className="h-3 w-3" /> Chase</>}
                                </Button>
                              ) : null}
                            </div>
                            <div className="divide-y divide-black/5">
                              {Array.from(categories.entries()).map(([category, docs]) => (
                                <div key={category} className="px-3 py-2">
                                  <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                                    <FolderClosed className="h-3 w-3" /> {category}
                                  </p>
                                  <div className="space-y-1">
                                    {docs.map((doc) => (
                                      <div key={doc.doc_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-1 py-1 hover:bg-subtle/60">
                                        <div className="min-w-0">
                                          <p className="truncate text-[11px] font-semibold text-ink">{doc.document_name}</p>
                                          <p className="text-[9px] text-muted">
                                            {doc.status === "Pending" ? `Requested ${prettyDate(doc.requested_date)}` : doc.received_date ? `Received ${prettyDate(doc.received_date)}` : "Filed"}
                                            {doc.file_name ? ` · ${doc.file_name}` : ""}
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <StatusPill status={doc.status} />
                                          {doc.status === "Pending" || doc.status === "Rejected" ? (
                                            <>
                                              <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-black/10 bg-white px-2 text-[9px] font-bold text-ink hover:bg-subtle">
                                                <Upload className="h-2.5 w-2.5" /> Upload
                                                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.doc,.docx,.txt,.zip" onChange={(e) => { void upload(doc, e.target.files?.[0]); e.target.value = ""; }} />
                                              </label>
                                              <Button size="sm" variant="ghost" loading={busy === doc.doc_id} onClick={() => void setDocStatus(doc, "Received")}>Received</Button>
                                              <button type="button" onClick={() => void setDocStatus(doc, "Waived")} className="rounded-full px-1.5 py-1 text-[9px] font-bold text-muted hover:bg-black/[0.04]">N/A</button>
                                            </>
                                          ) : doc.status === "Received" ? (
                                            <Button size="sm" variant="soft" loading={busy === doc.doc_id} onClick={() => void setDocStatus(doc, "Verified")}>Verify</Button>
                                          ) : doc.file_name ? (
                                            <a href={`/api/documents/${doc.doc_id}/file`} className="inline-flex h-7 items-center gap-1 rounded-full border border-black/10 bg-white px-2 text-[9px] font-bold text-ink hover:bg-subtle">
                                              <Download className="h-2.5 w-2.5" /> File
                                            </a>
                                          ) : null}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title={`Request documents — ${client?.name ?? ""}`} description="Creates or reuses the current period's checklist and queues the WhatsApp request.">
        <form onSubmit={requestPacket} className="space-y-3">
          <Field label="Service">
            <select required className="input" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
              {clientServices.map((service) => (
                <option key={service.service_id} value={service.service_code}>{getService(service.service_code).name} · {service.frequency}</option>
              ))}
            </select>
          </Field>
          <p className="rounded-xl bg-subtle px-3 py-2 text-[11px] leading-relaxed text-muted">
            The request is limited to three automatic reminders and stops as soon as every item is received or marked not applicable. The first message goes to the outbox (or WhatsApp if the Cloud API is connected).
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy === "new"}>Create packet & request</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Mini({ label, value, icon, tone = "sage", hint }: { label: string; value: number; icon: React.ReactNode; tone?: "sage" | "rose" | "green"; hint?: string }) {
  const tones = { sage: "bg-sage text-sage-ink", rose: "bg-[#FBEAE7] text-[#A33B2E]", green: "bg-[#E8F2EA] text-[#2F6B3F]" };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight text-ink">{value}</p>
        {hint ? <p className="truncate text-[9px] text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
