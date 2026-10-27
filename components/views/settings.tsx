"use client";

import * as React from "react";
import { Building2, Database, KeyRound, Mail, MessageCircle, Save, ShieldCheck, Sparkles, UserPlus, Users as UsersIcon } from "lucide-react";
import type { AuthUser, Settings } from "@/lib/types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import { useMutation } from "./shared";
import { prettyDateTime } from "@/lib/format";
import { AiUsageStrip } from "../ai-usage";

type Integration = {
  name: string;
  description: string;
  env: string;
  active: boolean;
  icon: React.ReactNode;
};

export function SettingsView({
  settings,
  system,
  users,
  currentRole,
}: {
  settings: Settings;
  system: { node: string; next: string; react: string; database: string };
  users?: AuthUser[] | null;
  currentRole?: string | null;
}) {
  const [form, setForm] = React.useState(settings);
  const { busy, mutate } = useMutation();
  const [pw, setPw] = React.useState({ current_password: "", new_password: "", confirm: "" });
  const [invite, setInvite] = React.useState({ username: "", name: "", role: "article", password: "" });

  const integrations: Integration[] = [
    { name: "Practice database", description: "Local SQLite; PAN/GSTIN columns encrypted at rest", env: "SQLite · .data/ca-suite.db", active: true, icon: <Database className="h-4 w-4" /> },
    { name: "Practice copilot", description: settings.ai_provider ? `LLM via ${settings.ai_provider} (${settings.ai_model})` : "Keyless mode — deterministic practice-data engine", env: settings.ai_provider || "GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / NVIDIA_API_KEY", active: Boolean(settings.ai_provider), icon: <Sparkles className="h-4 w-4" /> },
    { name: "WhatsApp Cloud API", description: "Client reminders and document chases", env: "WHATSAPP_ACCESS_TOKEN", active: false, icon: <MessageCircle className="h-4 w-4" /> },
    { name: "Email (SMTP)", description: "Invoice and compliance reminders", env: "EMAIL_APP_PASSWORD", active: false, icon: <Mail className="h-4 w-4" /> },
    { name: "Document vault", description: "Cloudflare R2 storage for client files", env: "R2_ACCESS_KEY_ID", active: false, icon: <ShieldCheck className="h-4 w-4" /> },
  ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: Settings = {};
    [
      "firm_name", "firm_tagline", "firm_city", "firm_phone", "firm_email",
      "firm_gstin", "ca_member_no", "firm_address",
    ].forEach((key) => { payload[key] = form[key] ?? ""; });
    const updated = await mutate<Settings>("/api/settings", "PUT", payload, "Firm profile updated");
    if (updated) setForm(updated);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Practice settings"
        description="Firm branding, statutory identity and the integrations that power automation."
      >
        <Button onClick={save} loading={busy}><Save className="h-4 w-4" /> Save changes</Button>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sage text-sage-ink"><Building2 className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-extrabold text-ink">Firm profile</h2>
              <p className="text-[11px] text-muted">Used across invoices, notices and the copilot</p>
            </div>
          </div>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Field label="Firm name"><input className="input" value={form.firm_name ?? ""} onChange={(e) => setForm({ ...form, firm_name: e.target.value })} /></Field>
            <Field label="Tagline"><input className="input" value={form.firm_tagline ?? ""} onChange={(e) => setForm({ ...form, firm_tagline: e.target.value })} /></Field>
            <Field label="City"><input className="input" value={form.firm_city ?? ""} onChange={(e) => setForm({ ...form, firm_city: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.firm_phone ?? ""} onChange={(e) => setForm({ ...form, firm_phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className="input" value={form.firm_email ?? ""} onChange={(e) => setForm({ ...form, firm_email: e.target.value })} /></Field>
            <Field label="Firm GSTIN"><input className="input font-mono" value={form.firm_gstin ?? ""} onChange={(e) => setForm({ ...form, firm_gstin: e.target.value })} /></Field>
            <Field label="CA membership no."><input className="input font-mono" value={form.ca_member_no ?? ""} onChange={(e) => setForm({ ...form, ca_member_no: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><input className="input" value={form.firm_address ?? ""} onChange={(e) => setForm({ ...form, firm_address: e.target.value })} /></Field>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" loading={busy}>Save profile</Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-extrabold text-ink">System</h2>
          <p className="text-[11px] text-muted">Migrated stack and runtime</p>
          <dl className="mt-4 space-y-2.5 text-xs">
            {[
              ["Framework", `Next.js ${system.next}`],
              ["UI runtime", `React ${system.react}`],
              ["Node.js", system.node],
              ["Database", system.database],
              ["Auth mode", settings.auth_mode || "Signed out"],
              ["Rendering", "Server components + streaming"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-black/5 pb-2 last:border-0">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card className="mt-3 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-extrabold text-ink">Integrations</h2>
            <p className="text-[11px] text-muted">Optional channels — the suite runs fully on the local database without them</p>
          </div>
          <Badge tone="green">Core online</Badge>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {integrations.map((it) => (
            <div key={it.name} className="flex items-start gap-3 rounded-2xl border border-black/5 p-3.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${it.active ? "bg-sage text-sage-ink" : "bg-black/[0.04] text-muted"}`}>{it.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-bold text-ink">{it.name}</p>
                  <Badge tone={it.active ? "green" : "neutral"}>{it.active ? "Active" : "Off"}</Badge>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{it.description}</p>
                <p className="mt-1 truncate font-mono text-[9px] text-muted/80">{it.env}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-3 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-ink">AI copilot &amp; data privacy</h2>
            <p className="text-[11px] text-muted">One toggle controls everything sent to an AI provider</p>
          </div>
          <Badge tone={settings.ai_enabled !== "false" ? "green" : "neutral"}>
            {settings.ai_enabled !== "false" ? "AI on" : "AI off"}
          </Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-black/5 p-4">
            <p className="text-xs font-bold text-ink">Provider</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {settings.ai_provider
                ? `${settings.ai_provider} · ${settings.ai_model} — keys stay on this machine in environment variables.`
                : "No API key configured — the copilot answers from the deterministic practice-data engine. Add GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or NVIDIA_API_KEY to upgrade (all have free tiers)."}
            </p>
            <p className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[10px] leading-relaxed text-muted">
              {settings.ai_required_scope}
            </p>
            <p className="mt-2 text-[10px] text-muted">
              PAN and GSTIN are stripped from every outbound prompt, documents never leave, and responses are not used for training by any supported provider.
            </p>
            <AiUsageStrip />
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-ink">
              <input
                type="checkbox"
                checked={settings.ai_enabled !== "false"}
                onChange={async (e) => {
                  await mutate<Settings>("/api/settings", "PUT", { ai_enabled: e.target.checked ? "true" : "false" }, e.target.checked ? "AI enabled" : "AI disabled — keyless mode");
                }}
                className="h-4 w-4 accent-[#3B5245]"
              />
              Allow outbound AI calls
            </label>
          </div>
          <div className="rounded-2xl border border-black/5 p-4">
            <p className="text-xs font-bold text-ink">Your account</p>
            <p className="mt-1 text-[11px] text-muted">
              Signed in as <span className="font-semibold text-ink">{settings.auth_mode || "—"}</span>.
              Sessions last 12 hours; passwords are scrypt-hashed.
            </p>
            <div className="mt-3 space-y-2">
              <Field label="Current password">
                <input className="input" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="New password">
                  <input className="input" type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
                </Field>
                <Field label="Confirm">
                  <input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => {
                  if (pw.new_password.length < 8) return;
                  if (pw.new_password !== pw.confirm) return;
                  void mutate("/api/auth/password", "PATCH", { current_password: pw.current_password, new_password: pw.new_password }, "Password changed").then((ok) => {
                    if (ok) setPw({ current_password: "", new_password: "", confirm: "" });
                  });
                }}
              >
                <KeyRound className="h-4 w-4" /> Change password
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            { role: "Partner", rights: "Everything: settings, users, deletes, billing" },
            { role: "Manager", rights: "Clients, compliance, billing, documents — no settings or client deletes" },
            { role: "Article", rights: "Read-only plus own timesheets, messages and AI" },
          ].map((r) => (
            <div key={r.role} className="rounded-2xl bg-subtle p-3">
              <p className="text-[11px] font-extrabold text-ink">{r.role}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{r.rights}</p>
            </div>
          ))}
        </div>
      </Card>

      {users && currentRole === "partner" ? (
        <Card className="mt-3 p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sage text-sage-ink"><UsersIcon className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-extrabold text-ink">Firm accounts</h2>
              <p className="text-[11px] text-muted">Invite teammates with the minimum role their work needs</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-subtle/60 text-left">
                  {["User", "Username", "Role", "Last signed in"].map((h) => (
                    <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} className="border-t border-black/5">
                    <td className="px-3 py-2.5 text-xs font-semibold text-ink">{u.name}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-muted">{u.username}</td>
                    <td className="px-3 py-2.5"><Badge tone={u.role === "partner" ? "green" : u.role === "manager" ? "amber" : "neutral"}>{u.role}</Badge></td>
                    <td className="px-3 py-2.5 text-[11px] text-muted">{u.last_login ? prettyDateTime(u.last_login) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-2 border-t border-black/5 pt-4 sm:grid-cols-5">
            <Field label="Username"><input className="input" value={invite.username} onChange={(e) => setInvite({ ...invite, username: e.target.value })} placeholder="aarti" /></Field>
            <Field label="Full name"><input className="input" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Aarti Sharma" /></Field>
            <Field label="Role">
              <select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                <option value="article">article</option>
                <option value="manager">manager</option>
                <option value="partner">partner</option>
              </select>
            </Field>
            <Field label="Temp password"><input className="input" type="text" value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} placeholder="min 8 chars" /></Field>
            <div className="flex items-end">
              <Button
                className="w-full"
                loading={busy}
                onClick={() => {
                  void mutate<{ user?: AuthUser; error?: string }>(
                    "/api/users",
                    "POST",
                    { username: invite.username, name: invite.name, role: invite.role, password: invite.password },
                    `${invite.username} added`,
                  ).then((created) => {
                    if (created) setInvite({ username: "", name: "", role: "article", password: "" });
                  });
                }}
              >
                <UserPlus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
