"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CircleAlert,
  FileCheck2,
  FileText,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Client, ClientRegistration, OnboardingIssue } from "@/lib/types";
import {
  SERVICES,
  SERVICE_LINES,
  currentCycle,
  frequencyLabel,
  inspectGstin,
  isValidPhone,
  normalisePhone,
  panEntityWarning,
  validateCin,
  validateEmail,
  validatePan,
  validateTan,
} from "@/lib/services";
import { Badge, Button, Field } from "../ui";
import { Modal, useToast } from "../interactive";
import { inr, prettyDate, todayISO } from "@/lib/format";

type Staff = { name: string; role: string };

type RegistrationDraft = {
  kind: "GST" | "TAN" | "CIN" | "PAN" | "Other";
  identifier: string;
  legal_name: string;
  state: string;
  state_code: string;
  status: "Active" | "Suspended" | "Cancelled" | "Needs review";
  effective_from: string;
  effective_to: string;
  place_of_business: string;
  filing_frequency: string;
  is_primary: boolean;
};

type ServiceDraft = {
  code: string;
  registration_index: number;
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

const ENTITY_TYPES = ["Private Limited", "Public Limited", "LLP", "Proprietorship", "Partnership", "Trust", "HUF", "Individual", "Society", "Other"];
const STEPS = ["Identity", "Registrations", "Services", "Commercial", "Team", "Documents", "Communication", "Review"];
const STATUSES: RegistrationDraft["status"][] = ["Active", "Suspended", "Cancelled", "Needs review"];

const emptyRegistration = (patch: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  kind: "GST",
  identifier: "",
  legal_name: "",
  state: "Maharashtra",
  state_code: "",
  status: "Active",
  effective_from: "",
  effective_to: "",
  place_of_business: "",
  filing_frequency: "Monthly",
  is_primary: false,
  ...patch,
});

const empty = {
  legal_name: "",
  trade_name: "",
  entity_type: "Private Limited",
  pan: "",
  tan: "",
  cin: "",
  date_of_incorporation: "",
  date_of_birth: "",
  address: "",
  city: "",
  state: "Maharashtra",
  pincode: "",
  contact_person: "",
  primary_contact_designation: "",
  phone: "",
  whatsapp_number: "",
  email: "",
  billing_contact: "",
  authorised_representative: "",
  preferred_language: "English",
  preferred_channel: "WhatsApp" as "WhatsApp" | "Email" | "Phone",
  relationship_manager: "",
  notes: "",
  whatsapp_opt_in: false,
  whatsapp_consent_source: "",
  contact_verification_note: "",
  engagement_letter_status: "Not recorded",
  engagement_letter_date: "",
};

const COMPANY_ENTITIES = new Set(["Private Limited", "Public Limited", "LLP"]);

function teamDefaults(staff: Staff[]) {
  const partner = staff.find((person) => person.role === "partner")?.name ?? "";
  const manager = staff.find((person) => person.role === "manager")?.name ?? partner;
  const article = staff.find((person) => person.role === "article")?.name ?? manager;
  return { partner, manager, article, reviewer: manager || partner };
}

function gstService(code: string): boolean {
  return SERVICES.find((service) => service.code === code)?.line === "gst";
}

export function OnboardWizard({
  open,
  onClose,
  staff,
  clients,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  staff: Staff[];
  clients: Client[];
  onCreated: (client: Client) => void;
}) {
  const { toast } = useToast();
  const today = todayISO();
  const team = React.useMemo(() => teamDefaults(staff), [staff]);
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState(empty);
  const [registrations, setRegistrations] = React.useState<RegistrationDraft[]>([]);
  const [services, setServices] = React.useState<ServiceDraft[]>([]);
  const [line, setLine] = React.useState("gst");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<null | {
    client: Client;
    registrations: ClientRegistration[];
    summary: { services: number; active_services: number; cycles: number; documents: number; messages: number };
    issues: OnboardingIssue[];
    messages: Array<{ request_id: string; status: string; reason?: string }>;
  }>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm({ ...empty, relationship_manager: team.manager });
    setRegistrations([]);
    setServices([]);
    setLine("gst");
    setResult(null);
  }, [open, team.manager]);

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function addRegistrationDraft() {
    setRegistrations((previous) => [...previous, emptyRegistration({ legal_name: form.legal_name, state: form.state })]);
  }

  function updateRegistration(index: number, patch: Partial<RegistrationDraft>) {
    setRegistrations((previous) => previous.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
  }

  function removeRegistration(index: number) {
    setRegistrations((previous) => previous.filter((_, position) => position !== index));
    setServices((previous) =>
      previous.map((service) => ({
        ...service,
        registration_index: service.registration_index === index ? -1 : service.registration_index > index ? service.registration_index - 1 : service.registration_index,
      })),
    );
  }

  function defaultRegistrationIndex(code: string, drafts = registrations): number {
    if (!gstService(code)) return -1;
    const primary = drafts.findIndex((entry) => entry.kind === "GST" && entry.status === "Active" && entry.is_primary);
    if (primary >= 0) return primary;
    return drafts.findIndex((entry) => entry.kind === "GST" && entry.status === "Active");
  }

  function toggleService(code: string) {
    setServices((previous) => {
      if (previous.some((entry) => entry.code === code)) return previous.filter((entry) => entry.code !== code);
      const def = SERVICES.find((service) => service.code === code)!;
      return [
        ...previous,
        {
          code,
          registration_index: defaultRegistrationIndex(code),
          frequency: def.frequency,
          fee: def.defaultFee,
          billing_cycle: def.billingCycle,
          auto_invoice: true,
          owner: team.article,
          reviewer: team.reviewer === team.article ? team.partner : team.reviewer,
          manager: team.manager,
          partner: team.partner,
          start_date: today,
          end_date: "",
          fee_model: def.frequency === "one_time" ? "one_time" : "recurring",
          setup_fee: 0,
          payment_terms_days: 30,
          approval_stage: def.line === "audit" ? "review" : "none",
        },
      ];
    });
  }

  function updateService(code: string, patch: Partial<ServiceDraft>) {
    setServices((previous) => previous.map((entry) => (entry.code === code ? { ...entry, ...patch } : entry)));
  }

  // ── Client-side validation mirrors the server; the server remains authoritative.

  const gstRegistrations = registrations.filter((entry) => entry.kind === "GST" && entry.status === "Active");
  const identityErrors = [
    form.legal_name.trim().length < 2 ? "Legal name is required" : "",
    validatePan(form.pan) ?? "",
    validateTan(form.tan) ?? "",
    validateCin(form.cin) ?? "",
    COMPANY_ENTITIES.has(form.entity_type) && !form.date_of_incorporation ? "Incorporation date is required for this entity type" : "",
    form.entity_type === "Individual" && !form.date_of_birth ? "Date of birth is recommended for an individual" : "",
    !form.address.trim() && form.entity_type !== "Individual" ? "Registered address is required" : "",
    !form.city.trim() ? "City is required" : "",
    !form.state.trim() ? "State is required" : "",
    form.pincode && !/^\d{6}$/.test(form.pincode) ? "PIN code must be 6 digits" : "",
  ].filter(Boolean);
  const panWarning = form.pan && !validatePan(form.pan) ? panEntityWarning(form.pan, form.entity_type) : null;
  const contactErrors = [
    !form.contact_person.trim() ? "Primary contact name is required" : "",
    !isValidPhone(form.phone) ? "Enter a valid 10-digit Indian mobile number" : "",
    form.whatsapp_number && !isValidPhone(form.whatsapp_number) ? "Enter a valid WhatsApp number" : "",
    validateEmail(form.email) ?? "",
    form.whatsapp_opt_in && !form.whatsapp_consent_source.trim() ? "Record how WhatsApp consent was obtained" : "",
  ].filter(Boolean);
  const registrationErrors = registrations.flatMap((registration, index) => {
    const prefix = `Registration ${index + 1}: `;
    const errors: string[] = [];
    if (!registration.identifier.trim()) errors.push(`${prefix}number is required`);
    if (registration.kind === "GST") {
      const info = inspectGstin(registration.identifier);
      if (!info.valid) errors.push(`${prefix}${info.error ?? "invalid GSTIN"}`);
      if (form.pan && info.valid && info.pan !== form.pan.toUpperCase()) errors.push(`${prefix}GSTIN embeds a different PAN`);
      if (!registration.legal_name.trim()) errors.push(`${prefix}legal name on the GST registration is required`);
      if (registration.effective_from && registration.effective_to && registration.effective_from > registration.effective_to) {
        errors.push(`${prefix}closure date cannot precede the effective date`);
      }
    }
    if (registration.kind === "TAN" && validateTan(registration.identifier)) errors.push(`${prefix}${validateTan(registration.identifier)}`);
    if (registration.kind === "CIN" && validateCin(registration.identifier)) errors.push(`${prefix}${validateCin(registration.identifier)}`);
    if (registration.kind === "PAN" && validatePan(registration.identifier)) errors.push(`${prefix}${validatePan(registration.identifier)}`);
    return errors;
  });
  const serviceErrors = services.flatMap((service) => {
    const def = SERVICES.find((entry) => entry.code === service.code)!;
    const prefix = `${def.short}: `;
    const errors: string[] = [];
    if (gstService(service.code) && service.registration_index < 0) errors.push(`${prefix}choose an active GST registration`);
    if (!service.owner) errors.push(`${prefix}preparer is required`);
    if (!service.reviewer) errors.push(`${prefix}reviewer is required`);
    if (service.auto_invoice && Number(service.fee) <= 0) errors.push(`${prefix}auto-billing requires a fee greater than zero`);
    if (!Number.isFinite(Number(service.fee)) || Number(service.fee) < 0) errors.push(`${prefix}fee must be zero or positive`);
    if (Number(service.payment_terms_days) < 0 || Number(service.payment_terms_days) > 180) errors.push(`${prefix}payment terms must be 0–180 days`);
    if (service.approval_stage !== "none" && service.owner && service.reviewer && service.owner === service.reviewer) {
      errors.push(`${prefix}reviewer must be independent of the preparer`);
    }
    if (service.end_date && service.start_date && service.end_date < service.start_date) errors.push(`${prefix}end date cannot precede the start date`);
    if (def.line === "tds" && !form.tan && !registrations.some((entry) => entry.kind === "TAN" && entry.status === "Active")) {
      errors.push(`${prefix}TAN is required for TDS services`);
    }
    if (def.line === "audit") {
      if (!service.partner) errors.push(`${prefix}authorised CA is required`);
      if (!["Received", "Approved"].includes(form.engagement_letter_status)) {
        errors.push(`${prefix}record the engagement letter as received or approved`);
      }
    }
    if (service.partner && staff.find((person) => person.name === service.partner)?.role !== "partner") {
      errors.push(`${prefix}the authorised CA must be a partner`);
    }
    if (service.reviewer && staff.find((person) => person.name === service.reviewer)?.role === "article") {
      errors.push(`${prefix}an article assistant cannot review filings`);
    }
    return errors;
  });
  const commercialErrors = [
    !form.engagement_letter_status ? "Engagement letter status is required" : "",
    form.engagement_letter_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.engagement_letter_date) ? "Use a valid engagement letter date" : "",
  ].filter(Boolean);
  const teamErrors = [
    !form.relationship_manager ? "Assign a client relationship manager" : "",
    ...services.filter((service) => !service.manager || !service.partner).map((service) => `${SERVICES.find((entry) => entry.code === service.code)?.short}: manager and authorised CA are required`),
  ].filter(Boolean);

  const stepErrors = [
    [...identityErrors, ...contactErrors],
    registrationErrors,
    services.length === 0 ? ["Select at least one service"] : serviceErrors,
    commercialErrors,
    teamErrors,
    [],
    contactErrors,
    [],
  ][step] ?? [];
  const allErrors = [...identityErrors, ...registrationErrors, ...serviceErrors, ...commercialErrors, ...teamErrors, ...contactErrors, ...(services.length === 0 ? ["Select at least one service"] : [])];
  const duplicate = clients.find(
    (client) => (form.pan && client.pan?.toUpperCase() === form.pan.toUpperCase()),
  );

  function next() {
    if (stepErrors.length) {
      toast(stepErrors[0]!, "error");
      return;
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  async function submit() {
    if (allErrors.length) {
      toast(allErrors[0]!, "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          phone: normalisePhone(form.phone),
          whatsapp_number: form.whatsapp_number ? normalisePhone(form.whatsapp_number) : "",
          registrations: registrations.map((registration) => ({
            ...registration,
            identifier: registration.kind === "Other" ? registration.identifier.trim() : registration.identifier.toUpperCase().replace(/\s/g, ""),
            legal_name: registration.legal_name || form.legal_name,
            state_code: registration.state_code || (registration.kind === "GST" ? registration.identifier.slice(0, 2) : ""),
          })),
          services: services.map((service) => ({
            code: service.code,
            registration_id: service.registration_index >= 0 ? `new:${service.registration_index}` : undefined,
            frequency: service.frequency,
            fee: service.fee,
            billing_cycle: service.billing_cycle,
            auto_invoice: service.auto_invoice,
            owner: service.owner,
            reviewer: service.reviewer,
            manager: service.manager,
            partner: service.partner,
            start_date: service.start_date,
            end_date: service.end_date || undefined,
            fee_model: service.fee_model,
            setup_fee: service.setup_fee,
            payment_terms_days: service.payment_terms_days,
            approval_stage: service.approval_stage,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: OnboardingIssue[];
        client?: Client;
        registrations?: ClientRegistration[];
        services?: unknown[];
        onboarding?: { active_services?: number };
        cycles?: unknown[];
        documents?: unknown;
        summary?: { services: number; active_services: number; cycles: number; documents: number; messages: number };
        messages?: Array<{ request_id: string; status: string; reason?: string }>;
      };
      if (!res.ok || !data.client) {
        const detail = data.issues?.map((issue) => issue.message).filter(Boolean).join(" · ");
        throw new Error(detail || data.error || "Could not onboard the client");
      }
      setResult({
        client: data.client,
        registrations: data.registrations ?? [],
        summary: data.summary ?? {
          services: services.length,
          active_services: data.onboarding?.active_services ?? 0,
          cycles: data.cycles?.length ?? 0,
          documents: 0,
          messages: 0,
        },
        issues: data.issues ?? [],
        messages: data.messages ?? [],
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not onboard the client", "error");
    } finally {
      setBusy(false);
    }
  }

  const selectedLine = SERVICE_LINES.find((entry) => entry.key === line) ?? SERVICE_LINES[0]!;
  const visible = SERVICES.filter((service) => service.line === selectedLine.key);
  const totalFee = services.reduce((sum, service) => sum + Number(service.fee || 0) + Number(service.setup_fee || 0), 0);
  const totalDocuments = services.reduce((sum, service) => sum + (SERVICES.find((entry) => entry.code === service.code)?.checklist.length ?? 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? `${result.client.name} is onboarded` : "Onboard a client"}
      description={
        result
          ? "The client, registrations, configured services and their first periods were created together."
          : "Identity → registrations → services → commercial terms → team → checklist → communication → activation."
      }
      wide
    >
      {result ? (
        <div className="space-y-4">
          <div className="rounded-3xl bg-sage p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-green">
                <BadgeCheck className="h-6 w-6" />
              </span>
              <div>
                <p className="text-lg font-extrabold text-ink">{result.client.name}</p>
                <p className="text-xs text-sage-ink">
                  {result.client.client_id} · {result.client.entity_type} · {result.client.city || result.client.state || "India"}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Services", result.summary.services],
                ["Active", result.summary.active_services],
                ["Periods opened", result.summary.cycles],
                ["Documents", result.summary.documents],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-white/70 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sage-ink/70">{label}</p>
                  <p className="text-xl font-extrabold text-ink">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-black/5 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                <Building2 className="h-3.5 w-3.5" /> Registrations captured
              </p>
              {result.registrations.length === 0 ? (
                <p className="text-xs text-muted">No separate registration was captured. The client is treated as unregistered.</p>
              ) : (
                <ul className="space-y-1.5">
                  {result.registrations.map((registration) => (
                    <li key={registration.registration_id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-ink">
                        {registration.kind} · {registration.state || registration.state_code || "—"}
                        {registration.is_primary ? " · primary" : ""}
                      </span>
                      <span className="font-mono text-muted">{registration.identifier_masked}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-black/5 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                <MessageCircle className="h-3.5 w-3.5" /> Communication
              </p>
              {result.messages.length === 0 ? (
                <p className="text-xs text-muted">
                  No WhatsApp message was sent. Document requests are ready for the later messaging phase; consent and provider configuration are checked then.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {result.messages.map((message) => (
                    <li key={message.request_id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink">{message.request_id}</span>
                      <Badge tone={message.status === "sent" ? "green" : message.status === "queued" ? "amber" : "neutral"}>{message.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {result.issues.length ? (
            <div className="rounded-2xl bg-gold-soft/60 p-3 text-[11px] text-gold">
              <p className="mb-1 font-bold">Activation notes</p>
              {result.issues.map((issue, index) => <p key={`${issue.message}-${index}`}>{issue.message}</p>)}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => { onCreated(result.client); onClose(); }}>
              Open client 360° <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {STEPS.map((label, index) => (
              <React.Fragment key={label}>
                <button
                  type="button"
                  onClick={() => index < step && setStep(index)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition ${
                    index === step ? "bg-green text-white" : index < step ? "bg-sage text-green" : "bg-black/[0.04] text-muted"
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${index === step ? "bg-white/20" : index < step ? "bg-white" : "bg-black/10"}`}>
                    {index < step ? <Check className="h-2.5 w-2.5" /> : index + 1}
                  </span>
                  {label}
                </button>
                {index < STEPS.length - 1 ? <span className="h-px w-2 shrink-0 bg-black/10" /> : null}
              </React.Fragment>
            ))}
          </div>

          {step === 0 ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Legal name" className="sm:col-span-2">
                  <input autoFocus className="input" value={form.legal_name} onChange={(event) => set("legal_name", event.target.value)} placeholder="Sharma Textiles Private Limited" />
                </Field>
                <Field label="Trade / business name">
                  <input className="input" value={form.trade_name} onChange={(event) => set("trade_name", event.target.value)} placeholder="Sharma Textiles" />
                </Field>
                <Field label="Entity type">
                  <select className="input" value={form.entity_type} onChange={(event) => set("entity_type", event.target.value)}>
                    {ENTITY_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="PAN" hint={panWarning ?? "Format is validated, not the income-tax record"}>
                  <input className="input font-mono" value={form.pan} onChange={(event) => set("pan", event.target.value.toUpperCase().slice(0, 10))} placeholder="AABCS1234A" />
                </Field>
                <Field label="TAN (optional)">
                  <input className="input font-mono" value={form.tan} onChange={(event) => set("tan", event.target.value.toUpperCase().slice(0, 10))} placeholder="MUMS12345A" />
                </Field>
                <Field label="CIN / LLPIN (optional)">
                  <input className="input font-mono" value={form.cin} onChange={(event) => set("cin", event.target.value.toUpperCase().slice(0, 21))} placeholder="U17120MH2005PTC123456" />
                </Field>
                <Field label={form.entity_type === "Individual" ? "Date of birth" : "Incorporation / establishment date"}>
                  <input
                    type="date"
                    className="input"
                    value={form.entity_type === "Individual" ? form.date_of_birth : form.date_of_incorporation}
                    onChange={(event) => set(form.entity_type === "Individual" ? "date_of_birth" : "date_of_incorporation", event.target.value)}
                  />
                </Field>
                <Field label="Registered address" className="sm:col-span-2">
                  <textarea className="input min-h-[64px]" value={form.address} onChange={(event) => set("address", event.target.value)} placeholder="Unit 4, Trade Centre, Andheri East" />
                </Field>
                <Field label="City">
                  <input className="input" value={form.city} onChange={(event) => set("city", event.target.value)} />
                </Field>
                <Field label="State">
                  <input className="input" value={form.state} onChange={(event) => set("state", event.target.value)} />
                </Field>
                <Field label="PIN code">
                  <input className="input" value={form.pincode} onChange={(event) => set("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
                </Field>
                <Field label="Primary contact name">
                  <input className="input" value={form.contact_person} onChange={(event) => set("contact_person", event.target.value)} placeholder="Rahul Sharma" />
                </Field>
                <Field label="Designation / relationship">
                  <input className="input" value={form.primary_contact_designation} onChange={(event) => set("primary_contact_designation", event.target.value)} placeholder="Director / Authorised signatory" />
                </Field>
                <Field label="Primary mobile">
                  <input className="input" value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="9820011223" inputMode="tel" />
                </Field>
                <Field label="Email">
                  <input type="email" className="input" value={form.email} onChange={(event) => set("email", event.target.value)} placeholder="accounts@client.in" />
                </Field>
              </div>
              {panWarning ? (
                <p className="flex items-start gap-2 rounded-xl bg-gold-soft/60 px-3 py-2 text-[11px] text-gold">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {panWarning}
                </p>
              ) : null}
              {duplicate ? (
                <p className="flex items-start gap-2 rounded-xl bg-[#FBEAE7] px-3 py-2 text-[11px] text-[#A33B2E]">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {duplicate.name} already has this PAN. Open that profile instead.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-extrabold text-ink">Registrations belong to the client — not the other way round.</p>
                  <p className="text-[11px] text-muted">Add each GSTIN separately, including additional states. A client with two GSTINs can run the same service twice, once per registration.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={addRegistrationDraft}><Plus className="h-3.5 w-3.5" /> Add registration</Button>
              </div>
              {registrations.length === 0 ? (
                <div className="rounded-2xl bg-subtle p-4 text-[11px] leading-relaxed text-muted">
                  No registration captured. That is valid for an individual or an unregistered business, but GST, TDS and audit services will ask for the missing registration during validation.
                </div>
              ) : (
                <div className="space-y-3">
                  {registrations.map((registration, index) => {
                    const info = registration.kind === "GST" ? inspectGstin(registration.identifier) : null;
                    return (
                      <div key={index} className="rounded-2xl border border-black/5 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-ink">Registration {index + 1}</p>
                          <Button size="sm" variant="ghost" onClick={() => removeRegistration(index)}><Trash2 className="h-3 w-3" /> Remove</Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <Field label="Type">
                            <select className="input" value={registration.kind} onChange={(event) => updateRegistration(index, { kind: event.target.value as RegistrationDraft["kind"] })}>
                              {(["GST", "TAN", "CIN", "PAN", "Other"] as const).map((kind) => <option key={kind}>{kind}</option>)}
                            </select>
                          </Field>
                          <Field label="Registration number" hint={info?.valid ? `${info.state} · PAN ${info.pan}` : info?.error}>
                            <input
                              className="input font-mono"
                              value={registration.identifier}
                              onChange={(event) => updateRegistration(index, {
                                identifier: event.target.value.toUpperCase(),
                                ...(registration.kind === "GST" ? { state_code: event.target.value.slice(0, 2) } : {}),
                              })}
                            />
                          </Field>
                          <Field label="Legal name on registration">
                            <input className="input" value={registration.legal_name} onChange={(event) => updateRegistration(index, { legal_name: event.target.value })} />
                          </Field>
                          <Field label="State">
                            <input className="input" value={registration.state} onChange={(event) => updateRegistration(index, { state: event.target.value })} />
                          </Field>
                          <Field label="Status">
                            <select className="input" value={registration.status} onChange={(event) => updateRegistration(index, { status: event.target.value as RegistrationDraft["status"] })}>
                              {STATUSES.map((status) => <option key={status}>{status}</option>)}
                            </select>
                          </Field>
                          <Field label="Filing frequency">
                            <select className="input" value={registration.filing_frequency} onChange={(event) => updateRegistration(index, { filing_frequency: event.target.value })}>
                              {["Monthly", "Quarterly", "Annual", "Not applicable"].map((frequency) => <option key={frequency}>{frequency}</option>)}
                            </select>
                          </Field>
                          <Field label="Effective from">
                            <input type="date" className="input" value={registration.effective_from} onChange={(event) => updateRegistration(index, { effective_from: event.target.value })} />
                          </Field>
                          <Field label="Closure date">
                            <input type="date" className="input" value={registration.effective_to} onChange={(event) => updateRegistration(index, { effective_to: event.target.value })} />
                          </Field>
                          <Field label="Place of business">
                            <input className="input" value={registration.place_of_business} onChange={(event) => updateRegistration(index, { place_of_business: event.target.value })} placeholder="Principal place" />
                          </Field>
                        </div>
                        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                          <input type="checkbox" checked={registration.is_primary} onChange={(event) => updateRegistration(index, { is_primary: event.target.checked })} className="h-3.5 w-3.5 accent-[#3B5244]" />
                          Use as the primary {registration.kind} registration for the legacy client fields and default service mapping
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {SERVICE_LINES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setLine(item.key)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${line === item.key ? "bg-ink text-white" : "bg-black/[0.04] text-muted hover:bg-black/[0.07]"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted">{selectedLine.blurb}. Select only the services this client has agreed to buy. Nothing is activated automatically.</p>
              <div className="grid gap-2">
                {visible.map((service) => {
                  const selected = services.find((entry) => entry.code === service.code);
                  const cycle = currentCycle(service, today);
                  return (
                    <div key={service.code} className={`rounded-2xl border p-3 transition ${selected ? "border-green/30 bg-sage/30" : "border-black/5 bg-white"}`}>
                      <button type="button" onClick={() => toggleService(service.code)} className="flex w-full items-start gap-3 text-left">
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-green bg-green text-white" : "border-black/15 bg-white"}`}>
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-ink">{service.name}</span>
                            <Badge tone={selected ? "green" : "neutral"}>{frequencyLabel(service.frequency)}</Badge>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted">{service.scheduleLabel} · {service.checklist.length} document{service.checklist.length === 1 ? "" : "s"}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">Current period</span>
                          <span className="block text-[11px] font-semibold text-ink">{cycle.period}</span>
                          <span className="block text-[10px] text-muted">due {prettyDate(cycle.due_date)}</span>
                        </span>
                      </button>
                      {selected ? (
                        <div className="mt-3 grid gap-2 border-t border-black/5 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Field label="Frequency">
                            <select className="input" value={selected.frequency} onChange={(event) => updateService(service.code, { frequency: event.target.value })}>
                              {["monthly", "quarterly", "annual", "one_time"].map((frequency) => (
                                <option key={frequency} value={frequency}>{frequencyLabel(frequency as Parameters<typeof frequencyLabel>[0])}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Fee per period">
                            <input type="number" min={0} step={100} className="input" value={selected.fee} onChange={(event) => updateService(service.code, { fee: Number(event.target.value) })} />
                          </Field>
                          <Field label="Billing cycle">
                            <select className="input" value={selected.billing_cycle} onChange={(event) => updateService(service.code, { billing_cycle: event.target.value })}>
                              {["per_cycle", "monthly", "quarterly", "annual"].map((cycleValue) => <option key={cycleValue} value={cycleValue}>{cycleValue.replace("_", " ")}</option>)}
                            </select>
                          </Field>
                          <Field label="Auto-bill">
                            <select className="input" value={selected.auto_invoice ? "yes" : "no"} onChange={(event) => updateService(service.code, { auto_invoice: event.target.value === "yes" })}>
                              <option value="yes">Invoice when done</option>
                              <option value="no">Bill manually</option>
                            </select>
                          </Field>
                          {gstService(service.code) ? (
                            <Field label="GST registration" className="sm:col-span-2">
                              <select className="input" value={selected.registration_index} onChange={(event) => updateService(service.code, { registration_index: Number(event.target.value) })}>
                                <option value={-1}>Choose a registration</option>
                                {gstRegistrations.map((registration) => {
                                  const index = registrations.indexOf(registration);
                                  return <option key={index} value={index}>{registration.state || `State ${registration.state_code}`} · {registration.identifier || "not entered"}</option>;
                                })}
                              </select>
                            </Field>
                          ) : null}
                          <Field label="Start date">
                            <input type="date" className="input" value={selected.start_date} onChange={(event) => updateService(service.code, { start_date: event.target.value })} />
                          </Field>
                          <Field label="End date (optional)">
                            <input type="date" className="input" value={selected.end_date} onChange={(event) => updateService(service.code, { end_date: event.target.value })} />
                          </Field>
                          <Field label="Fee model">
                            <select className="input" value={selected.fee_model} onChange={(event) => updateService(service.code, { fee_model: event.target.value })}>
                              {["fixed", "recurring", "per_period", "milestone", "one_time"].map((model) => <option key={model} value={model}>{model.replace("_", " ")}</option>)}
                            </select>
                          </Field>
                          <Field label="Setup fee">
                            <input type="number" min={0} step={100} className="input" value={selected.setup_fee} onChange={(event) => updateService(service.code, { setup_fee: Number(event.target.value) })} />
                          </Field>
                          <Field label="Payment terms (days)">
                            <input type="number" min={0} max={180} step={1} className="input" value={selected.payment_terms_days} onChange={(event) => updateService(service.code, { payment_terms_days: Number(event.target.value) })} />
                          </Field>
                          <Field label="Approval stage">
                            <select className="input" value={selected.approval_stage} onChange={(event) => updateService(service.code, { approval_stage: event.target.value })}>
                              <option value="none">No extra approval</option>
                              <option value="review">Manager review</option>
                              <option value="partner">Partner approval</option>
                            </select>
                          </Field>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="rounded-2xl bg-subtle p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink">{services.length} service{services.length === 1 ? "" : "s"} selected</p>
                  <p className="text-xs font-semibold text-muted">{inr(totalFee)} incl. setup</p>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Activation opens the current period, its checklist and an onboarding task set. It is idempotent — retrying cannot create a second period.
                </p>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><FileText className="h-3.5 w-3.5" /> Engagement and commercial terms</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Engagement letter">
                    <select className="input" value={form.engagement_letter_status} onChange={(event) => set("engagement_letter_status", event.target.value)}>
                      {["Not recorded", "Requested", "Received", "Approved"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </Field>
                  <Field label="Letter date">
                    <input type="date" className="input" value={form.engagement_letter_date} onChange={(event) => set("engagement_letter_date", event.target.value)} />
                  </Field>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  No invoice is raised at onboarding. Fees, billing cycle, setup fee and payment terms are stored per service for the billing phase. Audit services require the letter before activation.
                </p>
              </div>
              <div className="space-y-2">
                {services.map((service) => {
                  const def = SERVICES.find((entry) => entry.code === service.code)!;
                  return (
                    <div key={service.code} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-subtle px-3 py-2 text-[11px]">
                      <span className="font-semibold text-ink">{def.short}</span>
                      <span className="text-muted">{inr(service.fee)} + {inr(service.setup_fee)} setup · {service.billing_cycle.replace("_", " ")} · {service.payment_terms_days} days</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Client relationship manager">
                  <select className="input" value={form.relationship_manager} onChange={(event) => set("relationship_manager", event.target.value)}>
                    <option value="">Not assigned</option>
                    {staff.map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}
                  </select>
                </Field>
                <Field label="Billing contact">
                  <input className="input" value={form.billing_contact} onChange={(event) => set("billing_contact", event.target.value)} placeholder="Accounts payable contact" />
                </Field>
              </div>
              <div className="space-y-2">
                {services.map((service) => {
                  const def = SERVICES.find((entry) => entry.code === service.code)!;
                  return (
                    <div key={service.code} className="rounded-2xl border border-black/5 p-3">
                      <p className="mb-2 text-xs font-bold text-ink">{def.short}</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Preparer">
                          <select className="input" value={service.owner} onChange={(event) => updateService(service.code, { owner: event.target.value })}>
                            {staff.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Reviewer">
                          <select className="input" value={service.reviewer} onChange={(event) => updateService(service.code, { reviewer: event.target.value })}>
                            {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Manager">
                          <select className="input" value={service.manager} onChange={(event) => updateService(service.code, { manager: event.target.value })}>
                            {staff.filter((person) => person.role !== "article").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Authorised CA">
                          <select className="input" value={service.partner} onChange={(event) => updateService(service.code, { partner: event.target.value })}>
                            {staff.filter((person) => person.role === "partner").map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}
                          </select>
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="rounded-xl bg-subtle p-3 text-[11px] leading-relaxed text-muted">
                Each service keeps its own team. Changing the relationship manager later does not overwrite service assignments.
              </p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><FileCheck2 className="h-3.5 w-3.5" /> Initial document checklist</p>
                <p className="mb-3 text-[11px] leading-relaxed text-muted">
                  {totalDocuments} document{totalDocuments === 1 ? "" : "s"} will be requested across {services.length} service{services.length === 1 ? "" : "s"}. Only selected services are included; optional items never block the workflow.
                </p>
                <div className="space-y-2">
                  {services.map((service) => {
                    const def = SERVICES.find((entry) => entry.code === service.code)!;
                    return (
                      <div key={service.code} className="rounded-xl bg-subtle px-3 py-2">
                        <p className="flex items-center justify-between gap-2 text-[11px] font-bold text-ink">
                          <span>{def.short}</span>
                          <span className="text-muted">{def.checklist.length} items</span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-[10px] text-muted">{def.checklist.map((item) => item.name).join(" · ")}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><Sparkles className="h-3.5 w-3.5" /> Onboarding tasks</p>
                <ul className="space-y-1 text-[11px] text-muted">
                  <li>Confirm scope and engagement letter with the client</li>
                  <li>Verify opening information and registrations for each service</li>
                  <li>Confirm billing terms before invoice automation</li>
                  <li>Assign a relationship manager if one is missing</li>
                </ul>
                <p className="mt-2 text-[10px] text-muted">No email, WhatsApp message or public upload link is created during onboarding.</p>
              </div>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="WhatsApp number (if different)">
                  <input className="input" value={form.whatsapp_number} onChange={(event) => set("whatsapp_number", event.target.value)} placeholder="9820011223" inputMode="tel" />
                </Field>
                <Field label="Preferred channel">
                  <select className="input" value={form.preferred_channel} onChange={(event) => set("preferred_channel", event.target.value as typeof form.preferred_channel)}>
                    {["WhatsApp", "Email", "Phone"].map((channel) => <option key={channel}>{channel}</option>)}
                  </select>
                </Field>
                <Field label="Preferred language">
                  <select className="input" value={form.preferred_language} onChange={(event) => set("preferred_language", event.target.value)}>
                    {["English", "Hindi", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali"].map((language) => <option key={language}>{language}</option>)}
                  </select>
                </Field>
                <Field label="Authorised representative">
                  <input className="input" value={form.authorised_representative} onChange={(event) => set("authorised_representative", event.target.value)} />
                </Field>
                <Field label="Contact verification note" className="sm:col-span-2">
                  <input className="input" value={form.contact_verification_note} onChange={(event) => set("contact_verification_note", event.target.value)} placeholder="How the mobile/email was confirmed — a format check is not ownership" />
                </Field>
              </div>
              <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${form.whatsapp_opt_in ? "border-green/30 bg-sage/40" : "border-black/10"}`}>
                <input type="checkbox" checked={form.whatsapp_opt_in} onChange={(event) => set("whatsapp_opt_in", event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#3B5244]" />
                <span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink"><ShieldCheck className="h-3.5 w-3.5" /> Client consents to WhatsApp updates</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    A valid phone number is not consent. Record the source below. Messaging stays disabled during onboarding and is checked again when the provider is configured.
                  </span>
                </span>
              </label>
              {form.whatsapp_opt_in ? (
                <Field label="Consent evidence">
                  <input className="input" value={form.whatsapp_consent_source} onChange={(event) => set("whatsapp_consent_source", event.target.value)} placeholder="Signed engagement letter dated 1 April 2026 / WhatsApp confirmation" />
                </Field>
              ) : null}
              <Field label="Internal notes (restricted)">
                <textarea className="input min-h-[60px]" value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Visible to partners and managers, hidden from article assistants" />
              </Field>
            </div>
          ) : null}

          {step === 7 ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-black/5 p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><Building2 className="h-3.5 w-3.5" /> Client</p>
                  <p className="text-sm font-bold text-ink">{form.legal_name || "—"}</p>
                  <p className="text-xs text-muted">{form.entity_type} · {form.city || form.state || "—"}</p>
                  <p className="mt-2 font-mono text-[11px] text-ink">PAN {form.pan || "—"} · {registrations.filter((entry) => entry.kind === "GST").length} GSTIN(s)</p>
                  <p className="mt-1 text-[11px] text-muted">{form.contact_person} · +91 {normalisePhone(form.phone) || "—"} · {form.email}</p>
                  <p className="mt-1 text-[11px] text-muted">Manager: {form.relationship_manager || "unassigned"}</p>
                </div>
                <div className="rounded-2xl border border-black/5 p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><UserRound className="h-3.5 w-3.5" /> Readiness</p>
                  {[
                    ["Identity complete", identityErrors.length === 0 && !duplicate],
                    ["Registrations valid", registrationErrors.length === 0],
                    ["Services configured", services.length > 0 && serviceErrors.length === 0],
                    ["Commercial terms", commercialErrors.length === 0],
                    ["Team assigned", teamErrors.length === 0],
                    ["Communication", contactErrors.length === 0],
                  ].map(([label, ready]) => (
                    <p key={String(label)} className="flex items-center gap-2 text-[11px] text-ink">
                      {ready ? <Check className="h-3 w-3 text-green" /> : <CircleAlert className="h-3 w-3 text-[#A33B2E]" />}
                      {label}
                    </p>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted"><Sparkles className="h-3.5 w-3.5" /> What activation will create</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["Engagements", `${services.length} service${services.length === 1 ? "" : "s"} at their own frequency and fee`],
                    ["Periods", `${services.length} current period${services.length === 1 ? "" : "s"}, duplicate-safe`],
                    ["Checklist", `${totalDocuments} document request${totalDocuments === 1 ? "" : "s"}`],
                    ["Messaging", form.whatsapp_opt_in ? `Consent recorded (${form.whatsapp_consent_source || "source missing"}) — no message sent now` : "Off — no WhatsApp consent"],
                  ].map(([title, detail]) => (
                    <div key={title} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sage text-green"><Check className="h-2.5 w-2.5" /></span>
                      <span>
                        <span className="block text-[11px] font-bold text-ink">{title}</span>
                        <span className="block text-[10px] text-muted">{detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {allErrors.length ? (
                <div className="rounded-xl bg-[#FBEAE7] px-3 py-2 text-[11px] text-[#A33B2E]">
                  {allErrors.slice(0, 6).map((error, index) => <p key={`${error}-${index}`}>{error}</p>)}
                  {allErrors.length > 6 ? <p>…and {allErrors.length - 6} more</p> : null}
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl bg-sage px-3 py-2 text-[11px] font-semibold text-green">
                  <Check className="h-3.5 w-3.5" /> Ready to activate. The server re-validates every field and every assignment.
                </p>
              )}
            </div>
          ) : null}

          {stepErrors.length && step !== 7 ? (
            <p className="flex items-center gap-2 rounded-xl bg-[#FBEAE7] px-3 py-2 text-[11px] text-[#A33B2E]">
              <CircleAlert className="h-3.5 w-3.5" /> {stepErrors[0]}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
              <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} disabled={Boolean(duplicate && step === 0)}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} loading={busy} disabled={Boolean(duplicate) || allErrors.length > 0}>
                <Plus className="h-4 w-4" /> Create client & activate services
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
