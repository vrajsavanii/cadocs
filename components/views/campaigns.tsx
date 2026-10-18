"use client";

import * as React from "react";
import { Copy, Mail, MessageCircle, Plus, Send, Users } from "lucide-react";
import type { Campaign, Client, Compliance, DocumentItem, Invoice } from "@/lib/types";
import { Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { SectionCard, useMutation } from "./shared";
import { inr, prettyDate } from "@/lib/format";

type AudienceKey = "all" | "compliance" | "invoices" | "documents";
type Channel = "WhatsApp" | "Email";

const AUDIENCES: Array<{ key: AudienceKey; label: string; hint: string }> = [
  { key: "all", label: "All clients", hint: "Everyone on the client master" },
  { key: "compliance", label: "Overdue compliance", hint: "Clients with a filing past its due date" },
  { key: "invoices", label: "Overdue fees", hint: "Clients with an unpaid, past-due invoice" },
  { key: "documents", label: "Pending documents", hint: "Clients yet to submit requested documents" },
];

const TEMPLATES: Record<AudienceKey, { name: string; message: string }> = {
  all: {
    name: "Monthly practice update",
    message:
      "Dear {name},\n\nA quick update from {firm}. You currently have {count} open compliance item(s) and {amount} outstanding on your account.\n\nPlease reply if you need anything prioritised this week.\n\nRegards,\n{firm}",
  },
  compliance: {
    name: "Compliance deadline reminder",
    message:
      "Dear {name},\n\nThis is a reminder from {firm} that {count} statutory filing(s) on your account are past their due date. Delaying further can attract late fees and interest.\n\nPlease share the pending documents today so we can file at the earliest.\n\nRegards,\n{firm}",
  },
  invoices: {
    name: "Fee recovery reminder",
    message:
      "Dear {name},\n\nA gentle reminder from {firm}: {amount} is outstanding against past-due invoices on your account.\n\nKindly arrange the payment at your earliest convenience, or reply if you would like the ledger resent.\n\nRegards,\n{firm}",
  },
  documents: {
    name: "Document chase",
    message:
      "Dear {name},\n\nWe are waiting on {count} document(s) from your team to complete the current filings. Could you share them by the end of this week?\n\nRegards,\n{firm}",
  },
};

type Recipient = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  count: number;
  amount: number;
};

function buildRecipients(
  key: AudienceKey,
  clients: Client[],
  compliance: Compliance[],
  documents: DocumentItem[],
  invoices: Invoice[],
): Recipient[] {
  return clients.flatMap((client) => {
    const overdueCompliance = compliance.filter((c) => c.client_name === client.name && c.status === "Overdue");
    const overdueInvoices = invoices.filter((i) => i.client_name === client.name && i.status === "Overdue");
    const pendingDocuments = documents.filter((d) => d.client_name === client.name && d.status === "Pending");
    const openCompliance = compliance.filter((c) => c.client_name === client.name && c.status !== "Filed");
    const outstanding = invoices
      .filter((i) => i.client_name === client.name && i.status !== "Paid" && i.status !== "Cancelled")
      .reduce((sum, i) => sum + i.total_amount, 0);

    let count = 0;
    let amount = 0;
    if (key === "compliance") {
      count = overdueCompliance.length;
      amount = 0;
    } else if (key === "invoices") {
      count = overdueInvoices.length;
      amount = overdueInvoices.reduce((sum, i) => sum + i.total_amount, 0);
    } else if (key === "documents") {
      count = pendingDocuments.length;
      amount = 0;
    } else {
      count = openCompliance.length;
      amount = outstanding;
    }

    const matches = key === "all" || count > 0;
    if (!matches) return [];

    return [{
      id: client.client_id,
      name: client.name,
      contact: client.contact_person,
      phone: client.phone,
      email: client.email,
      count,
      amount,
    }];
  });
}

function resolveMessage(template: string, recipient: Recipient, firmName: string): string {
  return template
    .replaceAll("{name}", recipient.contact || recipient.name)
    .replaceAll("{contact}", recipient.contact || recipient.name)
    .replaceAll("{client}", recipient.name)
    .replaceAll("{firm}", firmName)
    .replaceAll("{count}", String(recipient.count))
    .replaceAll("{amount}", inr(recipient.amount));
}

function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

function mailtoLink(email: string, subject: string, text: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

export function CampaignsView({
  clients,
  compliance,
  documents,
  invoices,
  campaigns,
  firmName,
}: {
  clients: Client[];
  compliance: Compliance[];
  documents: DocumentItem[];
  invoices: Invoice[];
  campaigns: Campaign[];
  firmName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [audience, setAudience] = React.useState<AudienceKey>("compliance");
  const [channel, setChannel] = React.useState<Channel>("WhatsApp");
  const [name, setName] = React.useState(TEMPLATES.compliance.name);
  const [subject, setSubject] = React.useState("Pending compliance from {firm}");
  const [message, setMessage] = React.useState(TEMPLATES.compliance.message);
  const [dispatch, setDispatch] = React.useState<{ campaign: Campaign; items: Array<Recipient & { text: string }> } | null>(null);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();

  const recipients = React.useMemo(() => {
    const all = buildRecipients(audience, clients, compliance, documents, invoices);
    return channel === "WhatsApp" ? all.filter((r) => r.phone) : all.filter((r) => r.email);
  }, [audience, channel, clients, compliance, documents, invoices]);

  function openComposer() {
    setAudience("compliance");
    setChannel("WhatsApp");
    setName(TEMPLATES.compliance.name);
    setSubject("Pending compliance from {firm}");
    setMessage(TEMPLATES.compliance.message);
    setOpen(true);
  }

  function switchAudience(key: AudienceKey) {
    setAudience(key);
    setName(TEMPLATES[key].name);
    setMessage(TEMPLATES[key].message);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const items = recipients.map((r) => ({ ...r, text: resolveMessage(message, r, firmName) }));
    const audienceLabel = AUDIENCES.find((a) => a.key === audience)?.label ?? "All clients";
    const saved = await mutate<Campaign>(
      "/api/campaigns",
      "POST",
      { name, channel, audience: audienceLabel, subject, message, recipients: items.length },
      `Campaign saved for ${items.length} recipient${items.length === 1 ? "" : "s"}`,
    );
    if (saved) {
      setDispatch({ campaign: saved, items });
      setOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const previewItems = React.useMemo(
    () => recipients.slice(0, 3).map((r) => ({ ...r, text: resolveMessage(message, r, firmName) })),
    [recipients, message, firmName],
  );

  async function copyAll() {
    if (!dispatch) return;
    try {
      await navigator.clipboard.writeText(
        dispatch.items
          .map((i) => `${i.name} (${dispatch.campaign.channel === "WhatsApp" ? i.phone : i.email})\n${i.text}`)
          .join("\n\n———\n\n"),
      );
      toast("All messages copied");
    } catch {
      toast("Clipboard is blocked in this browser", "error");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Client communication"
        title="Campaigns"
        description="Compose one reminder, resolve it per client, and dispatch over WhatsApp or email without a bulk provider."
      >
        <Button onClick={openComposer}>
          <Plus className="h-4 w-4" /> New campaign
        </Button>
      </PageHeader>

      <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-black/5 bg-gold-soft/60 px-4 py-3 text-[11px] leading-relaxed text-muted">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        <p>
          Messages are prepared locally and recorded against the client ledger. Nothing is auto-sent — open each recipient&apos;s WhatsApp or mail
          client to dispatch. Add a provider later and the same campaign record can drive automatic delivery.
        </p>
      </div>

      {dispatch ? (
        <SectionCard
          title={`Ready to send · ${dispatch.items.length} recipient${dispatch.items.length === 1 ? "" : "s"}`}
          subtitle={`${dispatch.campaign.name} · ${dispatch.campaign.channel}`}
          className="mb-5"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={copyAll}>
                <Copy className="h-3.5 w-3.5" /> Copy all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDispatch(null)}>Dismiss</Button>
            </div>
          }
        >
          <div className="max-h-[360px] divide-y divide-black/5 overflow-y-auto">
            {dispatch.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink">{item.name}</p>
                  <p className="text-[11px] text-muted">
                    {item.contact} · {dispatch.campaign.channel === "WhatsApp" ? item.phone : item.email}
                  </p>
                  <p className="mt-1 line-clamp-2 max-w-xl whitespace-pre-line text-[11px] text-muted">{item.text}</p>
                </div>
                {dispatch.campaign.channel === "WhatsApp" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(whatsappLink(item.phone, item.text), "_blank", "noopener")}
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(mailtoLink(item.email, subject.replaceAll("{firm}", firmName), item.text), "_blank")}
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </Button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Campaign history" subtitle="Every prepared batch, with its audience and channel">
        {campaigns.length === 0 ? (
          <EmptyState
            icon={<Send className="h-5 w-5" />}
            title="No campaigns yet"
            description="Build a reminder for overdue filings, fees or documents in under a minute."
            action={<Button onClick={openComposer}><Plus className="h-4 w-4" /> New campaign</Button>}
          />
        ) : (
          <TableShell>
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Campaign</Th>
                  <Th>Channel</Th>
                  <Th>Audience</Th>
                  <Th>Recipients</Th>
                  <Th>Prepared</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.campaign_id} className="border-t border-black/5 transition hover:bg-subtle/50">
                    <Td>
                      <p className="text-sm font-semibold text-ink">{c.name}</p>
                      <p className="max-w-[320px] truncate text-[11px] text-muted">{c.subject || c.message.replace(/\n/g, " ")}</p>
                    </Td>
                    <Td>
                      <Badge tone={c.channel === "WhatsApp" ? "green" : "blue"}>
                        {c.channel === "WhatsApp" ? <MessageCircle className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                        {c.channel}
                      </Badge>
                    </Td>
                    <Td><span className="text-xs text-ink">{c.audience}</span></Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                        <Users className="h-3.5 w-3.5 text-muted" /> {c.recipients}
                      </span>
                    </Td>
                    <Td><span className="text-[11px] text-muted">{prettyDate(c.created_at)}</span></Td>
                    <Td><StatusPill status={c.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Compose a campaign"
        description="Choose an audience, write once, and preview how it resolves per client."
        wide
      >
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign name">
              <input required className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Channel">
              <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                <option>WhatsApp</option>
                <option>Email</option>
              </select>
            </Field>
            <Field label="Audience" className="sm:col-span-2" hint={AUDIENCES.find((a) => a.key === audience)?.hint}>
              <select className="input" value={audience} onChange={(e) => switchAudience(e.target.value as AudienceKey)}>
                {AUDIENCES.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Subject" className="sm:col-span-2" hint="Email only. Tokens like {firm} are resolved on send.">
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" className="sm:col-span-2" hint="Tokens: {name} {contact} {client} {firm} {count} {amount}">
              <textarea
                required
                rows={7}
                className="input min-h-[150px] resize-y py-2.5"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl bg-subtle p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Preview</p>
              <Badge tone={recipients.length ? "green" : "red"}>
                {recipients.length} reachable on {channel}
              </Badge>
            </div>
            {previewItems.length === 0 ? (
              <p className="text-[11px] text-muted">
                No client has a {channel === "WhatsApp" ? "phone number" : "email address"} for this audience.
              </p>
            ) : (
              <div className="space-y-2">
                {previewItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-black/5 bg-white p-2.5">
                    <p className="text-[10px] font-bold text-muted">{item.name} · {channel === "WhatsApp" ? item.phone : item.email}</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-[11px] text-ink">{item.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={recipients.length === 0}>
              Save campaign
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
