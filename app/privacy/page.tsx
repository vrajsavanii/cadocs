import Link from "next/link";
import { Lock, Server, Sparkles, ShieldCheck, Scale, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    icon: <Server className="h-4 w-4" />,
    title: "Your data stays on your machine",
    body: "This practice suite runs local-first: SQLite database and uploaded client files live in this workspace's .data/ folder. No telemetry, no analytics beacons, no third-party sync. Backups are yours to control.",
  },
  {
    icon: <Lock className="h-4 w-4" />,
    title: "Encryption & access control",
    body: "PAN and GSTIN values are encrypted at rest with AES-256-GCM (key in .data/field.key, never served over HTTP). Sessions are HMAC-signed, httpOnly cookies lasting 12 hours; passwords are hashed with scrypt with a unique salt. Every sign-in, mutation and export writes to the audit trail.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "Transport & browser hardening",
    body: "Content-Security-Policy, X-Frame-Options DENY, nosniff, strict referrer policy, opener isolation and (in production) HSTS are set on every response. Mutating requests are rejected cross-origin (CSRF), rate-limited per user, and login attempts are throttled per IP and username.",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    title: "AI processing — minimal and disclosed",
    body: "AI features work keyless from your own data. If you configure a provider key (Gemini, Groq, OpenRouter or NVIDIA — all free-tier capable), only aggregate practice facts are sent: counts, amounts, due dates and names. Documents, passwords, and PAN/GSTIN identifiers are never sent; identifiers are additionally stripped from every prompt. You can switch AI off entirely in Settings → AI copilot & data privacy. No supported provider is used to train models on these prompts.",
  },
  {
    icon: <Scale className="h-4 w-4" />,
    title: "DPDP Act 2023 readiness",
    body: "Purpose limitation: data you enter is used only to run your practice (filings, billing, reminders, records). Data-principal rights map to features here — access and portability via CSV export (Reports → CSV, per register), correction via client edit, erasure via guarded client deletion. Role-based access (Partner / Manager / Article) implements least-privilege sharing. Breach duties under the DPDP Rules (72-hour reporting) and CERT-In directions (6-hour reporting, 180-day log retention in India) are organisational obligations of the firm operating this software — the audit log is retained accordingly.",
  },
  {
    icon: <Trash2 className="h-4 w-4" />,
    title: "Retention & deletion",
    body: "Nothing is retained beyond what you keep. Deleting a client cascades to their compliance, document, invoice and payment records after confirmation; deleting .data removes the database, uploads, encryption keys and generated credentials entirely. Security logs should be retained 180 days as required by CERT-In's 2022 directions.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-[760px] px-5 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-green text-sm font-extrabold text-white">CA</span>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-ink">Privacy &amp; security notice</h1>
              <p className="text-[11px] text-muted">CADocs by NexAgent · how client data is protected</p>
            </div>
          </div>
          <Link href="/login" className="rounded-full bg-white px-4 py-2 text-xs font-bold text-ink shadow-sm ring-1 ring-black/10 transition hover:bg-subtle">
            Back to sign in
          </Link>
        </div>

        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <section key={s.title} className="rounded-2xl border border-black/5 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sage text-sage-ink">{s.icon}</span>
                {s.title}
              </h2>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">{s.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
          This page describes how the software handles data; it is not legal advice. The firm operating it remains the
          Data Fiduciary for its clients&apos; personal data under the DPDP Act, 2023.
        </p>
      </div>
    </div>
  );
}