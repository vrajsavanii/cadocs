"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarCheck2, FileSignature, Mail, MapPin, Pencil, Phone, Plus, ReceiptIndianRupee, Trash2, UserRound, Wallet } from "lucide-react";
import type { Client, ClientDetail } from "@/lib/types";
import { OnboardWizard } from "./onboard-wizard";
import { ClientProfileExtras } from "./client-profile-extras";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { compactInr, inr, prettyDate } from "@/lib/format";

const ENTITY_TYPES = ["Private Limited", "LLP", "Proprietorship", "Partnership", "Trust", "HUF", "Individual", "Other"];

const emptyForm = {
  name: "",
  legal_name: "",
  trade_name: "",
  contact_person: "",
  phone: "",
  email: "",
  entity_type: "Private Limited",
  gst_number: "",
  gst_registration_type: "Regular",
  pan: "",
  tan: "",
  cin: "",
  date_of_incorporation: "",
  address: "",
  pincode: "",
  services_opted: "GST Filing, ITR",
  city: "Mumbai",
  state: "Maharashtra",
  notes: "",
  relationship_manager: "",
  whatsapp_opt_in: true,
  client_status: "Active" as Client["client_status"],
};

export function ClientsView({
  clients,
  firmName,
  focusClientId,
  staff,
}: {
  clients: Client[];
  firmName: string;
  focusClientId?: string;
  staff: Array<{ name: string; role: string }>;
}) {
  const [query, setQuery] = React.useState("");
  const [entity, setEntity] = React.useState("All");
  const [addOpen, setAddOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<ClientDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return clients.filter((c) => {
      const matchesEntity = entity === "All" || c.entity_type === entity;
      const matchesQuery =
        !q ||
        [c.name, c.contact_person, c.phone, c.email, c.gst_number, c.pan, c.city, c.services_opted]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesEntity && matchesQuery;
    });
  }, [clients, entity, query]);

  React.useEffect(() => {
    if (!focusClientId) return;
    const match = clients.find((c) => c.client_id === focusClientId);
    if (match) void openClient(match);
    // Only react when the deep-linked client changes.
  }, [focusClientId]);

  const entityCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    clients.forEach((c) => map.set(c.entity_type, (map.get(c.entity_type) ?? 0) + 1));
    return map;
  }, [clients]);

  async function openClient(client: Client) {
    setDetail(null);
    setEditing(false);
    setConfirmDelete(false);
    setLoading(true);
    setForm({
      name: client.name,
      legal_name: client.legal_name ?? client.name,
      trade_name: client.trade_name ?? "",
      contact_person: client.contact_person,
      phone: client.phone,
      email: client.email,
      entity_type: client.entity_type,
      gst_number: client.gst_number,
      gst_registration_type: client.gst_registration_type ?? (client.gst_number ? "Regular" : "Unregistered"),
      pan: client.pan,
      tan: client.tan ?? "",
      cin: client.cin ?? "",
      date_of_incorporation: client.date_of_incorporation ?? "",
      address: client.address ?? "",
      pincode: client.pincode ?? "",
      services_opted: client.services_opted,
      city: client.city,
      state: client.state,
      notes: client.notes ?? "",
      relationship_manager: client.relationship_manager ?? "",
      whatsapp_opt_in: client.whatsapp_opt_in ?? true,
      client_status: client.client_status ?? "Active",
    });
    try {
      const res = await fetch(`/api/clients/${client.client_id}`);
      const data = (await res.json().catch(() => ({}))) as ClientDetail & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load the client");
      setDetail(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load the client", "error");
    } finally {
      setLoading(false);
    }
  }

  async function refreshDetail(clientId: string) {
    const res = await fetch(`/api/clients/${clientId}`);
    if (!res.ok) return;
    setDetail((await res.json()) as ClientDetail);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const updated = await mutate<Client>(`/api/clients/${detail.client.client_id}`, "PATCH", form, "Client profile updated");
    if (updated) {
      setEditing(false);
      await refreshDetail(detail.client.client_id);
    }
  }

  async function remove() {
    if (!detail) return;
    const id = detail.client.client_id;
    const result = await mutate(`/api/clients/${id}`, "DELETE", undefined, "Client removed");
    if (result) {
      setConfirmDelete(false);
      setDetail(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Client desk"
        title="Practice clients"
        description="Every engagement, KYC detail and service line in one searchable directory."
      >
        <a
          href="/api/export?type=clients"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-subtle"
        >
          Export CSV
        </a>
        <Button onClick={() => { setForm(emptyForm); setAddOpen(true); }}>
          <Plus className="h-4 w-4" /> Onboard client
        </Button>
      </PageHeader>

      <SectionCard
        title={`${filtered.length} of ${clients.length} clients`}
        subtitle="Search by name, GSTIN, PAN, city or service line — open a client for the full 360° view"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs
              options={[
                { value: "All", label: "All", count: clients.length },
                ...Array.from(entityCounts.entries()).map(([value, count]) => ({ value, label: value, count })),
              ]}
              value={entity}
              onChange={setEntity}
            />
            <SearchBox value={query} onChange={setQuery} placeholder="Search clients…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<UserRound className="h-5 w-5" />}
            title="No clients match that search"
            description="Try a different name, GSTIN or clear the filters."
            action={<Button variant="secondary" onClick={() => { setQuery(""); setEntity("All"); }}>Clear filters</Button>}
          />
        ) : (
          <TableShell>
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Client</Th>
                  <Th>Contact</Th>
                  <Th>GSTIN / PAN</Th>
                  <Th>Services</Th>
                  <Th>Location</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.client_id} className="border-t border-black/5 transition hover:bg-subtle/50">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.name} />
                        <div>
                          <p className="text-sm font-semibold text-ink">{c.name}</p>
                          <p className="text-[11px] text-muted">{c.client_id} · {c.entity_type}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <p className="text-xs font-semibold text-ink">{c.contact_person}</p>
                      <p className="text-[11px] text-muted">{c.phone}</p>
                    </Td>
                    <Td>
                      <p className="font-mono text-[11px] text-ink">{c.gst_number || "—"}</p>
                      <p className="font-mono text-[10px] text-muted">{c.pan || "—"}</p>
                    </Td>
                    <Td>
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {c.services_opted.split(",").slice(0, 2).map((s) => (
                          <Badge key={s} tone="sage">{s.trim()}</Badge>
                        ))}
                        {c.services_opted.split(",").length > 2 ? <Badge tone="neutral">+{c.services_opted.split(",").length - 2}</Badge> : null}
                      </div>
                    </Td>
                    <Td>
                      {c.city || c.state ? (
                        <>
                          <p className="text-xs text-ink">{c.city || "—"}</p>
                          <p className="text-[11px] text-muted">{c.state || "—"}</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted">Not captured</p>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => openClient(c)}>Open 360°</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <OnboardWizard
        open={addOpen}
        onClose={() => setAddOpen(false)}
        staff={staff}
        clients={clients}
        onCreated={(client) => {
          setAddOpen(false);
          router.refresh();
          void openClient(client);
        }}
      />

      <Modal
        open={Boolean(detail) || loading}
        onClose={() => { setDetail(null); setEditing(false); setConfirmDelete(false); }}
        title={detail?.client.name ?? "Client 360°"}
        description={detail ? `${detail.client.client_id} · ${detail.client.entity_type} · client since ${prettyDate(detail.client.created_at)}` : "Loading client record…"}
        wide
      >
        {loading ? <p className="py-8 text-center text-xs text-muted">Loading client record…</p> : null}
        {detail ? (
          <div className="space-y-4">
            {editing ? (
              <form onSubmit={saveEdit} className="space-y-3 rounded-2xl border border-black/5 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client / firm name" className="sm:col-span-2">
                    <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field label="Trade name">
                    <input className="input" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
                  </Field>
                  <Field label="Relationship manager">
                    <select className="input" value={form.relationship_manager} onChange={(e) => setForm({ ...form, relationship_manager: e.target.value })}>
                      <option value="">Not assigned</option>
                      {staff.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Contact person">
                    <input className="input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
                  </Field>
                  <Field label="WhatsApp / phone">
                    <input required className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </Field>
                  <Field label="Entity type">
                    <select className="input" value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
                      {ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="GSTIN">
                    <input className="input font-mono" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="PAN">
                    <input className="input font-mono" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="TAN">
                    <input className="input font-mono" value={form.tan} onChange={(e) => setForm({ ...form, tan: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="CIN / LLPIN">
                    <input className="input font-mono" value={form.cin} onChange={(e) => setForm({ ...form, cin: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="GST registration">
                    <select className="input" value={form.gst_registration_type} onChange={(e) => setForm({ ...form, gst_registration_type: e.target.value })}>
                      {["Regular", "Composition", "Unregistered"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </Field>
                  <Field label="Incorporation / DOB">
                    <input type="date" className="input" value={form.date_of_incorporation} onChange={(e) => setForm({ ...form, date_of_incorporation: e.target.value })} />
                  </Field>
                  <Field label="Registered address" className="sm:col-span-2">
                    <textarea className="input min-h-[60px]" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  </Field>
                  <Field label="City">
                    <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </Field>
                  <Field label="State">
                    <input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </Field>
                  <Field label="Pincode">
                    <input className="input" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
                  </Field>
                  <Field label="Client status">
                    <select className="input" value={form.client_status} onChange={(e) => setForm({ ...form, client_status: e.target.value as Client["client_status"] })}>
                      {["Active", "Paused", "Exited"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </Field>
                  <Field label="Services opted" className="sm:col-span-2">
                    <input className="input" value={form.services_opted} onChange={(e) => setForm({ ...form, services_opted: e.target.value })} />
                  </Field>
                  <label className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-[11px] font-semibold text-ink sm:col-span-2">
                    <input type="checkbox" checked={form.whatsapp_opt_in} onChange={(e) => setForm({ ...form, whatsapp_opt_in: e.target.checked })} className="h-3.5 w-3.5 accent-[#3B5244]" />
                    Client consents to WhatsApp document requests and invoice messages
                  </label>
                  <Field label="Notes" className="sm:col-span-2">
                    <textarea className="input min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button type="submit" loading={busy}>Save changes</Button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status={detail.client.client_status ?? "Active"} />
                    {(detail.services ?? []).slice(0, 4).map((service) => <Badge key={service.service_id} tone="sage">{service.service_name}</Badge>)}
                    {detail.client.whatsapp_opt_in ? <Badge tone="green">WhatsApp opted in</Badge> : <Badge tone="amber">WhatsApp off</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <AiAssist task="client_summary" id={detail.client.client_id} label="AI summary" title={`${detail.client.name} — relationship brief`} />
                    <ReminderButton
                      recipient={detail.client.contact_person || detail.client.name}
                      phone={detail.client.phone}
                      email={detail.client.email}
                      subject={`${firmName} — update on your account`}
                      relatedType="client"
                      relatedId={detail.client.client_id}
                      variant="secondary"
                      message={`Dear ${detail.client.contact_person || detail.client.name},\n\nA quick update from ${firmName} on your compliance account.\n\nOutstanding fees: ${inr(detail.totals.outstanding)}\nOpen filings: ${detail.compliance.filter((c) => c.status !== "Filed").length}\nPending documents: ${detail.documents.filter((d) => d.status === "Pending").length}\n\nPlease let us know if you need anything.\n\nRegards,\n${firmName}`}
                    />
                    <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    {confirmDelete ? (
                      <Button variant="danger" size="sm" onClick={remove} loading={busy}>Confirm delete</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                </div>

                {confirmDelete ? (
                  <p className="rounded-xl bg-[#FBEAE7] px-3 py-2 text-[10px] leading-relaxed text-[#A33B2E]">
                    Deleting is only allowed when the client has no compliance tasks, documents or invoices. Remove or reassign those first.
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Money label="Billed" value={compactInr(detail.totals.billed)} />
                  <Money label="Collected" value={compactInr(detail.totals.collected)} tone="green" />
                  <Money label="Outstanding" value={compactInr(detail.totals.outstanding)} tone="gold" />
                  <Money label="Overdue" value={compactInr(detail.totals.overdue)} tone="rose" />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Detail icon={<UserRound className="h-3.5 w-3.5" />} label="Contact person" value={detail.client.contact_person || "—"} />
                  <Detail icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={detail.client.phone} />
                  <Detail icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={detail.client.email || "—"} />
                  <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={[detail.client.city, detail.client.state].filter(Boolean).join(", ") || "Not captured"} />
                  <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="GSTIN" value={detail.client.gst_number || "—"} mono />
                  <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="PAN" value={detail.client.pan || "—"} mono />
                  <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="TAN" value={detail.client.tan || "—"} mono />
                  <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="CIN / LLPIN" value={detail.client.cin || "—"} mono />
                  <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="Registered address" value={[detail.client.address, detail.client.pincode].filter(Boolean).join(" — ") || "Not captured"} />
                  <Detail icon={<UserRound className="h-3.5 w-3.5" />} label="Relationship manager" value={detail.client.relationship_manager || "Not assigned"} />
                </div>

                <ClientProfileExtras detail={detail} staff={staff} onRefresh={() => void refreshDetail(detail.client.client_id)} />
              </>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel
                title="Compliance"
                icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
                count={detail.compliance.length}
                empty="No compliance tasks yet."
              >
                {detail.compliance.slice(0, 6).map((c) => (
                  <Row
                    key={c.compliance_id}
                    title={c.compliance_type}
                    subtitle={`${c.period} · due ${prettyDate(c.due_date)}`}
                    right={<StatusPill status={c.status} />}
                  />
                ))}
              </Panel>

              <Panel
                title="Documents"
                icon={<FileSignature className="h-3.5 w-3.5" />}
                count={detail.documents.length}
                empty="No document requests yet."
              >
                {detail.documents.slice(0, 6).map((d) => (
                  <Row
                    key={d.doc_id}
                    title={d.document_name}
                    subtitle={`Requested ${prettyDate(d.requested_date)}${d.file_name ? ` · ${d.file_name}` : ""}`}
                    right={<StatusPill status={d.status} />}
                  />
                ))}
              </Panel>

              <Panel
                title="Invoices"
                icon={<ReceiptIndianRupee className="h-3.5 w-3.5" />}
                count={detail.invoices.length}
                empty="No invoices raised yet."
              >
                {detail.invoices.slice(0, 6).map((i) => (
                  <Row
                    key={i.invoice_id}
                    title={`${i.invoice_id} · ${inr(i.total_amount)}`}
                    subtitle={`${i.service_description} · due ${prettyDate(i.due_date)}`}
                    right={<StatusPill status={i.status} />}
                  />
                ))}
              </Panel>

              <Panel
                title="Proposals & communication"
                icon={<FileSignature className="h-3.5 w-3.5" />}
                count={detail.proposals.length + detail.messages.length}
                empty="No proposals or reminders logged yet."
              >
                {detail.proposals.slice(0, 3).map((p) => (
                  <Row
                    key={p.proposal_id}
                    title={`${p.fee} · ${p.services.split(",")[0]?.trim() || "Engagement"}`}
                    subtitle={`Proposal ${p.proposal_id} · ${prettyDate(p.created_at)}`}
                    right={<StatusPill status={p.status} />}
                  />
                ))}
                {detail.messages.slice(0, 4).map((m) => (
                  <Row
                    key={m.message_id}
                    title={`${m.channel} reminder`}
                    subtitle={`${m.subject || m.body.slice(0, 46)} · ${prettyDate(m.created_at)}`}
                    right={<Badge tone="blue">Logged</Badge>}
                  />
                ))}
              </Panel>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={`/api/export?type=invoices`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
              >
                <Wallet className="h-3.5 w-3.5" /> Export invoices
              </a>
              <Button variant="secondary" size="sm" onClick={() => window.open(`tel:${detail.client.phone}`)}>
                <Phone className="h-3.5 w-3.5" /> Call
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Panel({ title, icon, count, empty, children }: { title: string; icon: React.ReactNode; count: number; empty: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <div className="rounded-2xl border border-black/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{icon}{title}</p>
        <Badge tone={count ? "sage" : "neutral"}>{count}</Badge>
      </div>
      {items.length === 0 ? <p className="py-3 text-[11px] text-muted">{empty}</p> : <div>{items}</div>}
    </div>
  );
}

function Row({ title, subtitle, right }: { title: string; subtitle: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-black/5 py-2 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-ink">{title}</p>
        <p className="truncate text-[10px] text-muted">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function Money({ label, value, tone = "sage" }: { label: string; value: string; tone?: "sage" | "green" | "gold" | "rose" }) {
  const tones = {
    sage: "bg-subtle text-ink",
    green: "bg-sage text-sage-ink",
    gold: "bg-gold-soft text-gold",
    rose: "bg-[#FBEAE7] text-[#A33B2E]",
  };
  return (
    <div className={`rounded-2xl px-3 py-2 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold">{value}</p>
    </div>
  );
}

function Detail({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  // PAN / GSTIN / TAN / CIN get typed into tax portals all day. Make the
  // identifier itself the copy affordance: click to copy, with honest
  // feedback, instead of making staff drag-select a 10-character string.
  const copyable = mono && value && value !== "—" && value !== "Not captured";
  return (
    <div className="rounded-2xl border border-black/5 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">{icon}{label}</p>
      <CopyableValue value={value} copyable={Boolean(copyable)} />
    </div>
  );
}

function CopyableValue({ value, copyable }: { value: string; copyable: boolean }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!copyable) {
    return <p className="mt-1 text-xs font-semibold text-ink">{value}</p>;
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Click to copy ${value}`}
      className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-subtle"
    >
      <span className="font-mono text-xs font-semibold text-ink">{value}</span>
      <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide ${copied ? "text-green" : "text-muted"}`}>
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
