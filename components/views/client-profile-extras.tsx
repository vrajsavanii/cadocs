"use client";

import * as React from "react";
import {
  BellRing,
  Building2,
  Check,
  CircleDashed,
  Clock3,
  FileCheck2,
  FolderOpen,
  History,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ClientDetail, ClientRegistration, ClientService, WorkStage } from "@/lib/types";
import { Badge, Button, Field, Progress } from "../ui";
import { Modal, useToast } from "../interactive";
import { inr, prettyDate, prettyDateTime } from "@/lib/format";
import { SERVICES, SERVICE_LINES, frequencyLabel, stageInfo } from "@/lib/services";

const STAGE_TONE: Record<WorkStage, "neutral" | "amber" | "blue" | "purple" | "green"> = {
  documents: "amber",
  preparation: "blue",
  review: "purple",
  filing: "blue",
  signoff: "amber",
  done: "green",
};

type Staff = { name: string; role: string };

type RegistrationDraft = {
  kind: "GST" | "TAN" | "CIN" | "PAN" | "Other";
  identifier: string;
  legal_name: string;
  state: string;
  status: string;
  effective_from: string;
  effective_to: string;
  filing_frequency: string;
  place_of_business: string;
  is_primary: boolean;
};

type ServiceDraft = {
  code: string;
  registration_id: string;
  frequency: string;
  fee: number;
  billing_cycle: string;
  auto_invoice: boolean;
  owner: string;
  reviewer: string;
  manager: string;
  partner: string;
  start_date: string;
  end_date: string;
  fee_model: string;
  setup_fee: number;
  payment_terms_days: number;
  approval_stage: string;
};

function teamDefaults(staff: Staff[]) {
  const partner = staff.find((person) => person.role === "partner")?.name ?? "";
  const manager = staff.find((person) => person.role === "manager")?.name ?? partner;
  const article = staff.find((person) => person.role === "article")?.name ?? manager;
  return { partner, manager, article, reviewer: manager || partner };
}

function isGst(code: string): boolean {
  return SERVICES.find((service) => service.code === code)?.line === "gst";
}

function serviceTemplate(code: string, staff: Staff[], registrationId = ""): ServiceDraft {
  const def = SERVICES.find((service) => service.code === code)!;
  const team = teamDefaults(staff);
  return {
    code,
    registration_id: registrationId,
    frequency: def.frequency,
    fee: def.defaultFee,
    billing_cycle: def.billingCycle,
    auto_invoice: true,
    owner: team.article,
    reviewer: team.reviewer === team.article ? team.partner : team.reviewer,
    manager: team.manager,
    partner: team.partner,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    fee_model: def.frequency === "one_time" ? "one_time" : "recurring",
    setup_fee: 0,
    payment_terms_days: 30,
    approval_stage: def.line === "audit" ? "review" : "none",
  };
}

async function responseError(res: Response, data: { error?: string; issues?: Array<{ message: string }> }): Promise<string> {
  if (res.ok) return "";
  return data.issues?.map((issue) => issue.message).filter(Boolean).join(" · ") || data.error || "Request failed";
}

export function ClientProfileExtras({
  detail,
  staff,
  onRefresh,
}: {
  detail: ClientDetail;
  staff: Staff[];
  onRefresh: () => void;
}) {
  const services = detail.services ?? [];
  const requests = detail.requests ?? [];
  const registrations = detail.registrations ?? [];
  const assessment = detail.onboarding;
  const tasks = detail.onboarding_tasks ?? [];
  const { toast } = useToast();
  const [addOpen, setAddOpen] = React.useState(false);
  const [registrationOpen, setRegistrationOpen] = React.useState(false);
  const [configuring, setConfiguring] = React.useState<ClientService | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [chasing, setChasing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ServiceDraft>(() => serviceTemplate("gstr3b", staff));
  const [configDraft, setConfigDraft] = React.useState<ServiceDraft | null>(null);
  const [registrationDraft, setRegistrationDraft] = React.useState<RegistrationDraft>({
    kind: "GST",
    identifier: "",
    legal_name: detail.client.legal_name ?? detail.client.name,
    state: detail.client.state,
    status: "Active",
    effective_from: "",
    effective_to: "",
    filing_frequency: "Monthly",
    place_of_business: "",
    is_primary: registrations.filter((registration) => registration.kind === "GST").length === 0,
  });
  const [line, setLine] = React.useState("gst");

  const checklist = assessment?.checklist ?? [];
  const progress = assessment?.completeness ?? 0;
  const gstRegistrations = registrations.filter((registration) => registration.kind === "GST" && registration.status === "Active");

  function openAdd() {
    const firstGst = gstRegistrations.find((registration) => registration.is_primary) ?? gstRegistrations[0];
    setDraft(serviceTemplate("gstr3b", staff, firstGst?.registration_id ?? ""));
    setLine("gst");
    setAddOpen(true);
  }

  function openConfigure(service: ClientService) {
    setConfigDraft({
      code: service.service_code,
      registration_id: service.registration_id ?? "",
      frequency: service.frequency,
      fee: service.fee,
      billing_cycle: service.billing_cycle,
      auto_invoice: service.auto_invoice,
      owner: service.owner,
      reviewer: service.reviewer,
      manager: service.manager ?? "",
      partner: service.partner ?? "",
      start_date: service.start_date,
      end_date: service.end_date ?? "",
      fee_model: service.fee_model ?? "recurring",
      setup_fee: service.setup_fee ?? 0,
      payment_terms_days: service.payment_terms_days ?? 30,
      approval_stage: service.approval_stage ?? "none",
    });
    setConfiguring(service);
  }

  async function toggleService(service: ClientService) {
    setBusyId(service.service_id);
    try {
      const res = await fetch(`/api/client-services/${service.service_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: service.status === "Active" ? "Paused" : "Active" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast(service.status === "Active" ? "Engagement paused — future cycles stop" : "Engagement resumed");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update the engagement", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function activateDraft(service: ClientService) {
    setBusyId(service.service_id);
    try {
      const res = await fetch(`/api/clients/${detail.client.client_id}/onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: service.service_id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast("Service activated — first period opened");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not activate the service", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNewService(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("new");
    try {
      const res = await fetch(`/api/clients/${detail.client.client_id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, registration_id: draft.registration_id || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast("Service added — current period opened");
      setAddOpen(false);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add the service", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    if (!configuring || !configDraft) return;
    setBusyId(configuring.service_id);
    try {
      const res = await fetch(`/api/client-services/${configuring.service_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...configDraft,
          registration_id: configDraft.registration_id || "",
          end_date: configDraft.end_date || "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast("Service configuration saved");
      setConfiguring(null);
      setConfigDraft(null);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the service", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function addRegistration(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("registration");
    try {
      const res = await fetch(`/api/clients/${detail.client.client_id}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registrationDraft),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast("Registration added");
      setRegistrationOpen(false);
      setRegistrationDraft((previous) => ({ ...previous, identifier: "", effective_from: "", effective_to: "", place_of_business: "" }));
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add the registration", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function registrationStatus(registration: ClientRegistration, status: string) {
    setBusyId(registration.registration_id);
    try {
      const res = await fetch(`/api/registrations/${registration.registration_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      const error = await responseError(res, data);
      if (error) throw new Error(error);
      toast(`Registration marked ${status}`);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update the registration", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRegistration(registration: ClientRegistration) {
    setBusyId(registration.registration_id);
    try {
      const res = await fetch(`/api/registrations/${registration.registration_id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not remove the registration");
      toast("Registration removed");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the registration", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function chase(requestId: string, serviceName: string) {
    setChasing(requestId);
    try {
      const res = await fetch(`/api/document-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chase" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string; reason?: string };
      if (!res.ok) throw new Error(data.error || "Could not prepare the message");
      toast(`${serviceName}: ${data.status === "sent" ? "sent on WhatsApp" : "message added to the outbox"}`);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not prepare the message", "error");
    } finally {
      setChasing(null);
    }
  }

  const visible = SERVICES.filter((service) => service.line === line);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-black/5 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            <Sparkles className="h-3.5 w-3.5" /> Onboarding completeness
          </p>
          <div className="flex items-center gap-2">
            {assessment ? <Badge tone={assessment.can_activate ? "green" : "amber"}>{assessment.can_activate ? "Ready" : "Needs attention"}</Badge> : null}
            <span className="text-sm font-extrabold text-ink">{progress}%</span>
          </div>
        </div>
        <Progress value={progress} tone={progress === 100 ? "green" : progress >= 60 ? "green" : "amber"} />
        {checklist.length ? (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {checklist.map((item) => (
              <div key={item.key} className="flex items-start gap-2">
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-sage text-green" : "bg-black/[0.05] text-muted"}`}>
                  {item.done ? <Check className="h-2.5 w-2.5" /> : <CircleDashed className="h-2.5 w-2.5" />}
                </span>
                <span>
                  <span className="block text-[11px] font-semibold text-ink">{item.label}{item.required ? "" : " · optional"}</span>
                  <span className="block text-[10px] text-muted">{item.detail}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted">No onboarding assessment is available for this record.</p>
        )}
        {assessment?.issues?.some((issue) => issue.severity === "error") ? (
          <div className="mt-2 rounded-xl bg-[#FBEAE7] px-3 py-2 text-[10px] text-[#A33B2E]">
            {assessment.issues.filter((issue) => issue.severity === "error").slice(0, 4).map((issue, index) => (
              <p key={`${issue.message}-${index}`}>{issue.scope}{issue.service_code ? ` · ${issue.service_code}` : ""}: {issue.message}</p>
            ))}
          </div>
        ) : null}
        {assessment?.missing_registrations?.length ? (
          <p className="mt-2 text-[10px] text-gold">Missing active registration: {assessment.missing_registrations.join(", ")}</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-black/5 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><Building2 className="h-3.5 w-3.5" /> Registrations</p>
          <Button size="sm" variant="secondary" onClick={() => setRegistrationOpen(true)}><Plus className="h-3 w-3" /> Add</Button>
        </div>
        {registrations.length === 0 ? (
          <p className="py-2 text-[11px] text-muted">No separate registration. Add each GSTIN, TAN or CIN on its own row.</p>
        ) : (
          <div className="space-y-1.5">
            {registrations.map((registration) => (
              <div key={registration.registration_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-subtle/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-ink">
                    {registration.kind}
                    {registration.is_primary ? <Badge tone="sage">Primary</Badge> : null}
                    <Badge tone={registration.status === "Active" ? "green" : registration.status === "Needs review" ? "amber" : "neutral"}>{registration.status}</Badge>
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    <span className="font-mono">{registration.identifier ?? registration.identifier_masked}</span>
                    {registration.state ? ` · ${registration.state}` : ""}
                    {registration.filing_frequency ? ` · ${registration.filing_frequency}` : ""}
                    {registration.verification_status === "User entered" ? " · user-entered, not externally verified" : " · externally verified"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {registration.status !== "Active" ? (
                    <Button size="sm" variant="ghost" loading={busyId === registration.registration_id} onClick={() => void registrationStatus(registration, "Active")}>Activate</Button>
                  ) : (
                    <Button size="sm" variant="ghost" loading={busyId === registration.registration_id} onClick={() => void registrationStatus(registration, "Suspended")}>Suspend</Button>
                  )}
                  <Button size="sm" variant="ghost" loading={busyId === registration.registration_id} onClick={() => void removeRegistration(registration)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><Repeat className="h-3.5 w-3.5" /> Service engagements</p>
          <div className="flex items-center gap-1.5">
            <Badge tone={services.length ? "sage" : "neutral"}>{services.length}</Badge>
            <Button size="sm" variant="secondary" onClick={openAdd}><Plus className="h-3 w-3" /> Add service</Button>
          </div>
        </div>
        {services.length === 0 ? (
          <p className="py-3 text-[11px] text-muted">No service enrolled. Add one to open its first period and checklist.</p>
        ) : (
          <div className="space-y-2">
            {services.map((service) => {
              const cycle = detail.compliance.find((entry) => entry.service_id === service.service_id && (entry.stage ?? "documents") !== "done")
                ?? detail.compliance.find((entry) => entry.service_id === service.service_id);
              const stage = (cycle?.stage ?? "done") as WorkStage;
              const registration = registrations.find((entry) => entry.registration_id === service.registration_id);
              return (
                <div key={service.service_id} className="rounded-xl bg-subtle/60 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink">
                        {service.service_name}
                        <Badge tone={service.status === "Active" ? "sage" : service.status === "Paused" ? "amber" : "neutral"}>{service.status}</Badge>
                        {registration ? <Badge tone="blue">{registration.state || registration.identifier_masked}</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {frequencyLabel(service.frequency)} · {inr(service.fee)}/period · {service.billing_cycle.replace("_", " ")} · {service.payment_terms_days ?? 30}-day terms
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        preparer {service.owner || "unassigned"} → reviewer {service.reviewer || "unassigned"} · manager {service.manager || "unassigned"} · CA {service.partner || "unassigned"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {cycle ? <Badge tone={STAGE_TONE[stage]}>{stageInfo(stage).label}</Badge> : null}
                      {service.status === "Draft" ? (
                        <Button size="sm" variant="secondary" loading={busyId === service.service_id} onClick={() => void activateDraft(service)}><Play className="h-3 w-3" /> Activate</Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => openConfigure(service)}><Pencil className="h-3 w-3" /> Configure</Button>
                      <Button size="sm" variant="ghost" loading={busyId === service.service_id} onClick={() => void toggleService(service)}>
                        {service.status === "Active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        {service.status === "Active" ? "Pause" : "Resume"}
                      </Button>
                    </div>
                  </div>
                  {cycle ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                      <span>{cycle.period}</span>
                      <span>due {prettyDate(cycle.due_date)}</span>
                      <span>{cycle.stage === "done" ? "Closed" : `Docs ${detail.documents.filter((doc) => doc.compliance_id === cycle.compliance_id && (doc.status === "Received" || doc.status === "Verified")).length}/${detail.documents.filter((doc) => doc.compliance_id === cycle.compliance_id).length}`}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><MessageCircle className="h-3.5 w-3.5" /> Document packets & reminders</p>
          <Badge tone={requests.some((request) => request.status === "Open") ? "amber" : "sage"}>{requests.filter((request) => request.status === "Open").length} open</Badge>
        </div>
        {requests.length === 0 ? (
          <p className="py-3 text-[11px] text-muted">No document request packets yet.</p>
        ) : (
          <div className="space-y-1.5">
            {requests.slice(0, 6).map((request) => {
              const docs = detail.documents.filter((doc) => doc.request_id === request.request_id);
              const pending = docs.filter((doc) => doc.status === "Pending" || doc.status === "Rejected").length;
              const capped = request.reminders_sent >= request.reminder_cap;
              return (
                <div key={request.request_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 py-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-ink">
                      {request.period} · {SERVICES.find((service) => service.code === request.service_code)?.short ?? request.service_code}
                    </p>
                    <p className="text-[10px] text-muted">
                      {docs.length - pending}/{docs.length} in · {request.status === "Open" ? `next reminder ${request.next_reminder_on ? prettyDate(request.next_reminder_on) : "not scheduled"}` : request.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5" title={`${request.reminders_sent} of ${request.reminder_cap} reminders used`}>
                      {Array.from({ length: request.reminder_cap }).map((_, index) => (
                        <span key={index} className={`h-1.5 w-3 rounded-full ${index < request.reminders_sent ? "bg-gold" : "bg-black/10"}`} />
                      ))}
                    </span>
                    {request.status === "Open" && pending > 0 ? (
                      <Button size="sm" variant="secondary" loading={chasing === request.request_id} disabled={capped} onClick={() => void chase(request.request_id, request.period)}>
                        {capped ? "Cap reached" : <><Send className="h-3 w-3" /> Chase</>}
                      </Button>
                    ) : (
                      <Badge tone="green"><FolderOpen className="h-3 w-3" /> Cleared</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-black/5 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><BellRing className="h-3.5 w-3.5" /> Onboarding tasks</p>
          {tasks.length === 0 ? (
            <p className="py-2 text-[11px] text-muted">No open onboarding tasks.</p>
          ) : (
            <div className="space-y-1.5">
              {tasks.slice(0, 6).map((task) => (
                <div key={task.task_id} className="flex items-start justify-between gap-2 text-[10px]">
                  <span className="flex items-start gap-1.5 text-ink">
                    {task.status === "Done" ? <Check className="mt-0.5 h-3 w-3 text-green" /> : <CircleDashed className="mt-0.5 h-3 w-3 text-muted" />}
                    {task.label}
                  </span>
                  <span className="shrink-0 text-muted">{task.status === "Done" ? "Done" : `due ${prettyDate(task.due_date)}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-black/5 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><ShieldCheck className="h-3.5 w-3.5" /> Communication & consent</p>
          <div className="space-y-1 text-[10px] text-muted">
            <p>Preferred channel <b className="text-ink">{detail.client.preferred_channel ?? "WhatsApp"}</b> · language <b className="text-ink">{detail.client.preferred_language ?? "English"}</b></p>
            <p>WhatsApp <b className={detail.client.whatsapp_opt_in ? "text-green" : "text-gold"}>{detail.client.whatsapp_opt_in ? "opted in" : "no consent"}</b>{detail.client.whatsapp_consent_source ? ` · ${detail.client.whatsapp_consent_source}` : ""}</p>
            <p>Contact verified <b className="text-ink">{detail.client.contact_verified_at ? prettyDate(detail.client.contact_verified_at) : "not recorded"}</b>{detail.client.contact_verification_note ? ` · ${detail.client.contact_verification_note}` : ""}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><Clock3 className="h-3.5 w-3.5" /> Recent workflow trail</p>
        {(detail.timeline ?? []).length === 0 ? (
          <p className="py-2 text-[11px] text-muted">No stage moves recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(detail.timeline ?? []).slice(0, 6).map((event) => (
              <div key={event.event_id} className="flex items-start justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-ink">
                  <FileCheck2 className="h-3 w-3 text-green" />
                  {event.from_stage ? `${stageInfo(event.from_stage).label} → ` : "Opened → "}{stageInfo(event.to_stage).label}
                  <span className="text-muted">· {event.actor}</span>
                </span>
                <span className="shrink-0 text-muted">{prettyDateTime(event.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted"><History className="h-3.5 w-3.5" /> Audit history</p>
        {(detail.audit ?? []).length === 0 ? (
          <p className="py-2 text-[11px] text-muted">No profile, registration or service audit entries yet.</p>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {(detail.audit ?? []).slice(0, 20).map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-2 text-[10px]">
                <span className="min-w-0">
                  <b className="text-ink">{entry.action.replaceAll("_", " ").toLowerCase()}</b>
                  <span className="text-muted"> · {entry.detail}</span>
                </span>
                <span className="shrink-0 text-muted">{prettyDateTime(entry.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={registrationOpen} onClose={() => setRegistrationOpen(false)} title="Add a registration" description="Each GSTIN gets its own row. The client master stays single.">
        <form onSubmit={addRegistration} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className="input" value={registrationDraft.kind} onChange={(event) => setRegistrationDraft({ ...registrationDraft, kind: event.target.value as RegistrationDraft["kind"] })}>
                {(["GST", "TAN", "CIN", "PAN", "Other"] as const).map((kind) => <option key={kind}>{kind}</option>)}
              </select>
            </Field>
            <Field label="Registration number">
              <input required className="input font-mono" value={registrationDraft.identifier} onChange={(event) => setRegistrationDraft({ ...registrationDraft, identifier: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Legal name on registration" className="sm:col-span-2">
              <input required className="input" value={registrationDraft.legal_name} onChange={(event) => setRegistrationDraft({ ...registrationDraft, legal_name: event.target.value })} />
            </Field>
            <Field label="State">
              <input className="input" value={registrationDraft.state} onChange={(event) => setRegistrationDraft({ ...registrationDraft, state: event.target.value })} />
            </Field>
            <Field label="Filing frequency">
              <select className="input" value={registrationDraft.filing_frequency} onChange={(event) => setRegistrationDraft({ ...registrationDraft, filing_frequency: event.target.value })}>
                {["Monthly", "Quarterly", "Annual", "Not applicable"].map((frequency) => <option key={frequency}>{frequency}</option>)}
              </select>
            </Field>
            <Field label="Effective from">
              <input type="date" className="input" value={registrationDraft.effective_from} onChange={(event) => setRegistrationDraft({ ...registrationDraft, effective_from: event.target.value })} />
            </Field>
            <Field label="Closure date">
              <input type="date" className="input" value={registrationDraft.effective_to} onChange={(event) => setRegistrationDraft({ ...registrationDraft, effective_to: event.target.value })} />
            </Field>
            <Field label="Place of business" className="sm:col-span-2">
              <input className="input" value={registrationDraft.place_of_business} onChange={(event) => setRegistrationDraft({ ...registrationDraft, place_of_business: event.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input type="checkbox" checked={registrationDraft.is_primary} onChange={(event) => setRegistrationDraft({ ...registrationDraft, is_primary: event.target.checked })} className="h-3.5 w-3.5 accent-[#3B5244]" />
            Primary {registrationDraft.kind} registration
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRegistrationOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busyId === "registration"}>Add registration</Button>
          </div>
        </form>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a service engagement" description="Configure the service first; activation opens its current period and checklist.">
        <form onSubmit={saveNewService} className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {SERVICE_LINES.map((item) => (
              <button key={item.key} type="button" onClick={() => setLine(item.key)} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${line === item.key ? "bg-ink text-white" : "bg-black/[0.04] text-muted"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <Field label="Service">
            <select
              className="input"
              value={draft.code}
              onChange={(event) => {
                const code = event.target.value;
                const firstGst = gstRegistrations.find((registration) => registration.is_primary) ?? gstRegistrations[0];
                setDraft(serviceTemplate(code, staff, isGst(code) ? firstGst?.registration_id ?? "" : ""));
              }}
            >
              {visible.map((service) => <option key={service.code} value={service.code}>{service.name} · {service.frequency}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Frequency">
              <select className="input" value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value })}>
                {["monthly", "quarterly", "annual", "one_time"].map((frequency) => <option key={frequency} value={frequency}>{frequencyLabel(frequency as Parameters<typeof frequencyLabel>[0])}</option>)}
              </select>
            </Field>
            <Field label="Fee per period">
              <input type="number" min={0} step={100} className="input" value={draft.fee} onChange={(event) => setDraft({ ...draft, fee: Number(event.target.value) })} />
            </Field>
            <Field label="Billing cycle">
              <select className="input" value={draft.billing_cycle} onChange={(event) => setDraft({ ...draft, billing_cycle: event.target.value })}>
                {["per_cycle", "monthly", "quarterly", "annual"].map((cycle) => <option key={cycle} value={cycle}>{cycle.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Auto-bill">
              <select className="input" value={draft.auto_invoice ? "yes" : "no"} onChange={(event) => setDraft({ ...draft, auto_invoice: event.target.value === "yes" })}>
                <option value="yes">Invoice when done</option>
                <option value="no">Bill manually</option>
              </select>
            </Field>
            {isGst(draft.code) ? (
              <Field label="GST registration" className="sm:col-span-2">
                <select className="input" value={draft.registration_id} onChange={(event) => setDraft({ ...draft, registration_id: event.target.value })}>
                  <option value="">Choose an active GST registration</option>
                  {gstRegistrations.map((registration) => (
                    <option key={registration.registration_id} value={registration.registration_id}>{registration.state || registration.identifier_masked} · {registration.identifier ?? registration.identifier_masked}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Preparer">
              <select className="input" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })}>
                {staff.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </Field>
            <Field label="Reviewer">
              <select className="input" value={draft.reviewer} onChange={(event) => setDraft({ ...draft, reviewer: event.target.value })}>
                {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </Field>
            <Field label="Manager">
              <select className="input" value={draft.manager} onChange={(event) => setDraft({ ...draft, manager: event.target.value })}>
                {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </Field>
            <Field label="Authorised CA">
              <select className="input" value={draft.partner} onChange={(event) => setDraft({ ...draft, partner: event.target.value })}>
                {staff.filter((person) => person.role === "partner").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </Field>
            <Field label="Payment terms (days)">
              <input type="number" min={0} max={180} className="input" value={draft.payment_terms_days} onChange={(event) => setDraft({ ...draft, payment_terms_days: Number(event.target.value) })} />
            </Field>
            <Field label="Approval stage">
              <select className="input" value={draft.approval_stage} onChange={(event) => setDraft({ ...draft, approval_stage: event.target.value })}>
                <option value="none">No extra approval</option>
                <option value="review">Manager review</option>
                <option value="partner">Partner approval</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busyId === "new"}>Add service</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(configuring)} onClose={() => { setConfiguring(null); setConfigDraft(null); }} title="Configure service" description="Changes apply to future periods. Historical filings and documents are never regenerated.">
        {configDraft ? (
          <form onSubmit={saveConfig} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Frequency">
                <select className="input" value={configDraft.frequency} onChange={(event) => setConfigDraft({ ...configDraft, frequency: event.target.value })}>
                  {["monthly", "quarterly", "annual", "one_time"].map((frequency) => <option key={frequency} value={frequency}>{frequencyLabel(frequency as Parameters<typeof frequencyLabel>[0])}</option>)}
                </select>
              </Field>
              <Field label="Fee per period">
                <input type="number" min={0} step={100} className="input" value={configDraft.fee} onChange={(event) => setConfigDraft({ ...configDraft, fee: Number(event.target.value) })} />
              </Field>
              <Field label="Billing cycle">
                <select className="input" value={configDraft.billing_cycle} onChange={(event) => setConfigDraft({ ...configDraft, billing_cycle: event.target.value })}>
                  {["per_cycle", "monthly", "quarterly", "annual"].map((cycle) => <option key={cycle} value={cycle}>{cycle.replace("_", " ")}</option>)}
                </select>
              </Field>
              <Field label="Auto-bill">
                <select className="input" value={configDraft.auto_invoice ? "yes" : "no"} onChange={(event) => setConfigDraft({ ...configDraft, auto_invoice: event.target.value === "yes" })}>
                  <option value="yes">Invoice when done</option>
                  <option value="no">Bill manually</option>
                </select>
              </Field>
              {isGst(configDraft.code) ? (
                <Field label="GST registration" className="sm:col-span-2">
                  <select className="input" value={configDraft.registration_id} onChange={(event) => setConfigDraft({ ...configDraft, registration_id: event.target.value })}>
                    <option value="">Choose an active GST registration</option>
                    {gstRegistrations.map((registration) => (
                      <option key={registration.registration_id} value={registration.registration_id}>{registration.state || registration.identifier_masked} · {registration.identifier ?? registration.identifier_masked}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Preparer">
                <select className="input" value={configDraft.owner} onChange={(event) => setConfigDraft({ ...configDraft, owner: event.target.value })}>
                  {staff.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Reviewer">
                <select className="input" value={configDraft.reviewer} onChange={(event) => setConfigDraft({ ...configDraft, reviewer: event.target.value })}>
                  {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Manager">
                <select className="input" value={configDraft.manager} onChange={(event) => setConfigDraft({ ...configDraft, manager: event.target.value })}>
                  {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Authorised CA">
                <select className="input" value={configDraft.partner} onChange={(event) => setConfigDraft({ ...configDraft, partner: event.target.value })}>
                  {staff.filter((person) => person.role === "partner").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Fee model">
                <select className="input" value={configDraft.fee_model} onChange={(event) => setConfigDraft({ ...configDraft, fee_model: event.target.value })}>
                  {["fixed", "recurring", "per_period", "milestone", "one_time"].map((model) => <option key={model} value={model}>{model.replace("_", " ")}</option>)}
                </select>
              </Field>
              <Field label="Setup fee">
                <input type="number" min={0} step={100} className="input" value={configDraft.setup_fee} onChange={(event) => setConfigDraft({ ...configDraft, setup_fee: Number(event.target.value) })} />
              </Field>
              <Field label="Payment terms (days)">
                <input type="number" min={0} max={180} className="input" value={configDraft.payment_terms_days} onChange={(event) => setConfigDraft({ ...configDraft, payment_terms_days: Number(event.target.value) })} />
              </Field>
              <Field label="Approval stage">
                <select className="input" value={configDraft.approval_stage} onChange={(event) => setConfigDraft({ ...configDraft, approval_stage: event.target.value })}>
                  <option value="none">No extra approval</option>
                  <option value="review">Manager review</option>
                  <option value="partner">Partner approval</option>
                </select>
              </Field>
              <Field label="Start date">
                <input type="date" className="input" value={configDraft.start_date} onChange={(event) => setConfigDraft({ ...configDraft, start_date: event.target.value })} />
              </Field>
              <Field label="End date">
                <input type="date" className="input" value={configDraft.end_date} onChange={(event) => setConfigDraft({ ...configDraft, end_date: event.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setConfiguring(null); setConfigDraft(null); }}>Cancel</Button>
              <Button type="submit" loading={busyId === configuring?.service_id}>Save configuration</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
