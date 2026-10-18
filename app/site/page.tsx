import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Ban,
  BarChart3,
  CalendarCheck2,
  Check,
  Clock3,
  FileSignature,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessageCircle,
  Phone,
  ReceiptIndianRupee,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Card, buttonClasses, cn } from "@/components/ui";
import { Counter, Reveal } from "@/components/site/anim";
import { DemoForm } from "@/components/site/demo-form";
import { MobileCta, SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { HeroMock, UseCasePanel } from "@/components/site/use-case";
import { WorkflowStory } from "@/components/site/workflow";
import {
  COMPANY_NAME,
  CONTACT,
  FAQS,
  HERO,
  MODULES,
  PROBLEMS,
  PRODUCT_NAME,
  PROMISES,
  ROLES,
  SECURITY,
  SITE_TAGLINE,
  TESTIMONIALS,
  TIERS,
  USE_CASES,
  VALUE_STRIP,
} from "@/lib/site-content";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Dashboard: LayoutDashboard,
  "AI Copilot": Sparkles,
  Documents: FolderOpen,
  Compliance: CalendarCheck2,
  Leads: Target,
  Proposals: FileSignature,
  Campaigns: Send,
  Invoices: ReceiptIndianRupee,
  Clients: Users,
  "UDIN Register": BadgeCheck,
  "DSC Tracker": KeyRound,
  Notices: AlertTriangle,
  Timesheets: Clock3,
  Reports: BarChart3,
  Settings: Gauge,
};

const SECURITY_ICONS = [KeyRound, Lock, ShieldCheck, ScrollText, Ban, Gauge];

export default function SitePage() {
  // The public site is CADocs by NexAgent. The firm name lives inside each
  // client's signed-in workspace, never on our own marketing pages.
  const phone = CONTACT.phone;
  const email = CONTACT.email;
  const whatsapp = CONTACT.whatsapp || phone;

  // `overflow-x-clip` absorbs the reveal slides without creating a scroll
  // container, so the sticky workflow stage keeps working.
  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas pb-20 lg:pb-0">
      <SiteHeader productName={PRODUCT_NAME} tagline={SITE_TAGLINE} />

      <main id="top">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[320px] -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-70 blur-3xl"
            style={{ background: "radial-gradient(ellipse at center, rgba(59,82,68,0.16), rgba(235,233,228,0) 70%)" }}
          />
          <div className="mx-auto max-w-[1180px] px-4 pt-8 sm:px-6 sm:pt-14">
            <div className="mx-auto max-w-3xl text-center">
              <Reveal variant="fade" duration={600}>
                <p className="inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/70 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-gold" />
                  {HERO.eyebrow}
                </p>
              </Reveal>
              <Reveal variant="rise" delay={60}>
                <h1 className="mt-5 text-[34px] font-extrabold leading-[1.06] tracking-tight text-ink sm:text-[52px]">{HERO.title}</h1>
              </Reveal>
              <Reveal variant="rise" delay={140}>
                <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-[17px]">{HERO.sub}</p>
              </Reveal>
              <Reveal variant="rise" delay={220}>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                  <a href="#demo" className={buttonClasses({ size: "lg", className: "px-7" })}>
                    {HERO.primaryCta}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                  <a href="#workflow" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                    {HERO.secondaryCta}
                  </a>
                </div>
              </Reveal>
              <Reveal variant="fade" delay={300}>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
                  {HERO.chips.map((chip) => (
                    <span key={chip} className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-bold text-muted">
                      {chip}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <div className="mt-10 sm:mt-14">
              <HeroMock />
              <p className="mt-4 text-center text-[11px] font-semibold text-muted">
                Not a designer&rsquo;s drawing — every screen on this page is the workspace itself, animating its own data.
              </p>
            </div>
          </div>
        </section>

        {/* ── Value strip ──────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_STRIP.map((item, i) => (
              <Reveal key={item.label} variant="zoom-in" delay={i * 70}>
                <Card className="h-full p-5">
                  <p className="text-[30px] font-extrabold leading-none tracking-tight text-green">
                    <Counter to={item.value} suffix={item.suffix} />
                  </p>
                  <p className="mt-2 text-[13px] font-bold text-ink">{item.label}</p>
                  <p className="mt-1 text-[11px] text-muted">{item.hint}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Why ──────────────────────────────────────────────────────────── */}
        <section id="why" className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6 sm:py-16">
          <Reveal variant="rise">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Why firms switch</p>
            <h2 className="mt-2 max-w-3xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
              A CA firm does not lose money on advice. It loses it on things nobody tracked.
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Reveal variant="left">
              <Card className="h-full p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#A33B2E]">Without a system</p>
                <ul className="mt-4 space-y-4">
                  {PROBLEMS.map((item) => (
                    <li key={item.title} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FBEAE7] text-[#A33B2E]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </span>
                      <span>
                        <span className="block text-[14px] font-bold text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{item.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>

            <Reveal variant="zoom-in" delay={100}>
              <Card className="h-full bg-white p-6 ring-1 ring-green/20">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-green">With {PRODUCT_NAME}</p>
                <ul className="mt-4 space-y-4">
                  {PROMISES.map((item) => (
                    <li key={item.title} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage text-green">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span>
                        <span className="block text-[14px] font-bold text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{item.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          </div>
        </section>

        {/* ── Workflow (scroll-driven) ─────────────────────────────────────── */}
        <section id="workflow" className="mx-auto max-w-[1180px] px-4 pt-10 sm:px-6 sm:pt-16">
          <WorkflowStory />
        </section>

        {/* ── Use cases ────────────────────────────────────────────────────── */}
        {/* Wider than the other bands on purpose: these panels are replicas of the
            real workspace at desktop density, so they need the extra width to stay
            legible instead of being squeezed into half a 1180px container. */}
        <section id="use-cases" className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-24">
          <Reveal variant="rise">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Use cases</p>
            <h2 className="mt-2 max-w-3xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
              Four jobs the firm does every week — done inside one workspace
            </h2>
          </Reveal>

          <div className="mt-12 space-y-16 sm:space-y-24">
            {USE_CASES.map((item) => (
              <div
                key={item.id}
                className={cn(
                  // The screen gets the wide column on purpose: the replica app is
                  // laid out at its real desktop density, so at half width its
                  // topbar chips and panels crush. Copy can breathe in less.
                  "grid items-center gap-6 lg:gap-10",
                  item.align === "right"
                    ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)] lg:[&>*:first-child]:order-2"
                    : "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]",
                  "[&>*]:min-w-0",
                )}
              >
                <Reveal variant={item.align === "left" ? "left" : "right"} duration={760} className="min-w-0">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">{item.eyebrow}</p>
                    <h3 className="mt-2 text-[24px] font-extrabold leading-[1.2] tracking-tight text-ink sm:text-[30px]">{item.title}</h3>
                    <p className="mt-3 text-[14px] leading-relaxed text-muted">{item.body}</p>
                    <ul className="mt-5 space-y-2.5">
                      {item.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2.5 text-[13px] leading-relaxed text-ink">
                          <Check className="mt-[3px] h-4 w-4 shrink-0 text-green" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-dashed border-black/10 px-3.5 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">Before</p>
                        <p className="mt-0.5 text-[12px] text-muted">{item.before}</p>
                      </div>
                      <div className="rounded-2xl bg-sage px-3.5 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sage-ink">With us</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-sage-ink">{item.after}</p>
                      </div>
                    </div>
                  </div>
                </Reveal>

                <UseCasePanel item={item} />
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA band ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-4 sm:px-6">
          <Reveal variant="zoom-in">
            <div className="flex flex-col items-start gap-5 rounded-[28px] bg-green px-6 py-8 text-white shadow-[0_40px_80px_-50px_rgba(45,63,52,0.9)] sm:flex-row sm:items-center sm:justify-between sm:px-10">
              <div>
                <h3 className="text-[22px] font-extrabold tracking-tight sm:text-[27px]">See it on your own busiest week</h3>
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-white/75">
                  Fifteen minutes, screen shared. Bring the client whose documents never arrive and the filing that keeps slipping —
                  that is what we will look at.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <a href="#demo" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-green">
                  Book a demo <ArrowRight className="h-4 w-4" />
                </a>
                {whatsapp ? (
                  <a
                    href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-6 text-[14px] font-semibold text-white"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Modules ──────────────────────────────────────────────────────── */}
        <section id="modules" className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6 sm:py-24">
          <Reveal variant="rise">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Modules</p>
            <h2 className="mt-2 max-w-3xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
              Fifteen modules, one login, one client record behind all of them
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
              Nothing is bolted on: a document request knows the client, an invoice knows the engagement, a notice knows the filing it
              followed.
            </p>
          </Reveal>

          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module, i) => {
              const Icon = MODULE_ICONS[module.name] ?? Gauge;
              return (
                <Reveal key={module.name} variant="rise" delay={(i % 3) * 60}>
                  <Card className="h-full p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sage text-sage-ink">
                      <Icon className="h-4 w-4" />
                    </span>
                    <p className="mt-3 text-[14px] font-extrabold tracking-tight text-ink">{module.name}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">{module.body}</p>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ── Roles ────────────────────────────────────────────────────────── */}
        <section id="roles" className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal variant="left">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Roles</p>
                <h2 className="mt-2 text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[36px]">
                  The article assistant cannot see what they should not
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  Permissions are enforced on the server for every request, not hidden in the interface. A read-only user is read-only
                  even if they type the URL.
                </p>
                <div className="mt-5 flex items-center gap-2 rounded-2xl bg-sage px-4 py-3 text-[12px] font-semibold text-sage-ink">
                  <ShieldCheck className="h-4 w-4" /> Every action is written to the audit trail with the person who did it.
                </div>
              </div>
            </Reveal>

            <div className="grid gap-3 sm:grid-cols-3">
              {ROLES.map((role, i) => (
                <Reveal key={role.name} variant="zoom-in" delay={i * 80}>
                  <Card className="h-full p-5">
                    <p className="text-[13px] font-extrabold tracking-tight text-ink">{role.name}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{role.body}</p>
                    <ul className="mt-3 space-y-1.5">
                      {role.can.map((item) => (
                        <li key={item} className="flex items-start gap-1.5 text-[11px] text-ink">
                          <Check className="mt-[2px] h-3.5 w-3.5 shrink-0 text-green" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Security ─────────────────────────────────────────────────────── */}
        <section id="security" className="border-y border-black/[0.06] bg-white/50 py-16 sm:py-24">
          <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
            <Reveal variant="rise">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Security &amp; privacy</p>
              <h2 className="mt-2 max-w-3xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
                Built for a profession that cannot afford a leak
              </h2>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
                Client financials, PAN, GSTIN, portal credentials and UDINs. The defaults assume that anyone with access has a reason
                to be there, and that you may need to prove who did what.
              </p>
            </Reveal>

            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item, i) => {
                const Icon = SECURITY_ICONS[i % SECURITY_ICONS.length]!;
                return (
                  <Reveal key={item.title} variant="rise" delay={(i % 3) * 60}>
                    <Card className="h-full p-5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gold-soft text-gold">
                        <Icon className="h-4 w-4" />
                      </span>
                      <p className="mt-3 text-[14px] font-extrabold tracking-tight text-ink">{item.title}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">{item.body}</p>
                    </Card>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Plans ────────────────────────────────────────────────────────── */}
        <section id="pricing" className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6 sm:py-24">
          <Reveal variant="rise">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Plans</p>
            <h2 className="mt-2 max-w-3xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
              Priced for the size of your firm, not per seat you add
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
              Every plan includes the compliance calendar, the client desk, document collection, invoicing and the AI copilot. We quote
              on the walkthrough call, so the number fits how you actually work.
            </p>
          </Reveal>

          <div className="mt-9 grid gap-4 lg:grid-cols-3">
            {TIERS.map((tier, i) => (
              <Reveal key={tier.name} variant="zoom-in" delay={i * 90}>
                <Card className={cn("flex h-full flex-col p-6", tier.featured && "ring-2 ring-green/25")}>
                  {tier.featured ? (
                    <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-green px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white">
                      Most chosen
                    </span>
                  ) : null}
                  <p className="text-[16px] font-extrabold tracking-tight text-ink">{tier.name}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{tier.body}</p>
                  <p className="mt-4 text-[13px] font-bold text-green">
                    {tier.price || "Pricing on the walkthrough call"}
                  </p>
                  <ul className="mt-4 space-y-2">
                    {tier.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-[12px] text-ink">
                        <Check className="mt-[2px] h-3.5 w-3.5 shrink-0 text-green" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="#demo"
                    className={buttonClasses({
                      variant: tier.featured ? "primary" : "secondary",
                      className: "mt-6 w-full justify-center",
                    })}
                  >
                    Book a demo
                  </a>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Testimonials (only when real quotes exist) ───────────────────── */}
        {TESTIMONIALS.length > 0 ? (
          <section className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6 sm:pb-24">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TESTIMONIALS.map((item) => (
                <Reveal key={item.name} variant="rise">
                  <Card className="h-full p-5">
                    <p className="text-[13px] leading-relaxed text-ink">&ldquo;{item.quote}&rdquo;</p>
                    <p className="mt-3 text-[12px] font-bold text-ink">{item.name}</p>
                    <p className="text-[11px] text-muted">{item.role}</p>
                  </Card>
                </Reveal>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section id="faq" className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <Reveal variant="left">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Questions</p>
                <h2 className="mt-2 text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[36px]">
                  The things partners ask before signing up
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  Still unsure about something specific to your firm? Ask it on the call — we would rather answer than sell.
                </p>
                <a href="#demo" className={buttonClasses({ variant: "secondary", className: "mt-5" })}>
                  Ask on a demo call
                </a>
              </div>
            </Reveal>

            <div className="divide-y divide-black/[0.06] overflow-hidden rounded-[24px] border border-black/[0.06] bg-white">
              {FAQS.map((faq) => (
                <details key={faq.q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-bold text-ink">
                    {faq.q}
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage text-sage-ink transition-transform duration-200 group-open:rotate-45">
                      <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                        <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Demo capture ─────────────────────────────────────────────────── */}
        <section id="demo" className="mx-auto max-w-[1180px] scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <Reveal variant="left">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Next step</p>
                <h2 className="mt-2 text-[30px] font-extrabold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
                  Fifteen minutes is usually enough to decide
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  We open a live workspace on the call and work through your week with you — the filings due, the documents stuck with
                  clients, the fees sitting past 60 days.
                </p>

                <ol className="mt-6 space-y-4">
                  {[
                    { title: "You send your details", body: "Name, mobile and what hurts most. That is the whole form." },
                    { title: "We call within one working day", body: "On WhatsApp or phone, whichever you picked." },
                    { title: "We show, you decide", body: "No slide deck, no obligation, and nothing to install to try it." },
                  ].map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green text-[11px] font-extrabold text-white">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-[14px] font-bold text-ink">{step.title}</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  {phone ? (
                    <a
                      href={`tel:${phone.replace(/\s/g, "")}`}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-5 text-[13px] font-semibold text-ink"
                    >
                      <Phone className="h-4 w-4 text-green" /> {phone}
                    </a>
                  ) : null}
                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-5 text-[13px] font-semibold text-ink"
                    >
                      <Send className="h-4 w-4 text-green" /> {email}
                    </a>
                  ) : null}
                </div>

                <p className="mt-6 text-[11px] leading-relaxed text-muted">
                  Prefer to look around first?{" "}
                  <Link href="/login" className="font-bold text-ink underline decoration-black/20 underline-offset-2">
                    Sign in to the workspace
                  </Link>{" "}
                  if you already have credentials, or read the{" "}
                  <Link href="/privacy" className="font-bold text-ink underline decoration-black/20 underline-offset-2">
                    privacy and security notice
                  </Link>
                  .
                </p>
              </div>
            </Reveal>

            <Reveal variant="zoom-in">
              <DemoForm whatsapp={whatsapp} productName={PRODUCT_NAME} companyName={COMPANY_NAME} />
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter
        productName={PRODUCT_NAME}
        companyName={COMPANY_NAME}
        tagline={SITE_TAGLINE}
        phone={phone}
        email={email}
        modules={MODULES.map((m) => m.name)}
      />
      <MobileCta whatsapp={whatsapp} phone={phone} />
    </div>
  );
}
