"use client";

/**
 * Animated product screens for the public site.
 *
 * Every screen is a faithful replica of the real module: same rail, same
 * topbar, same Card/Stat/StatusPill/Progress primitives from
 * `@/components/ui`, same tokens and type ramp as the application. Each screen
 * is a pure function of `step`, so the scroll-driven workflow and the
 * self-running use-case sections both drive the same markup.
 */
import * as React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  FileSignature,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  Plus,
  ReceiptIndianRupee,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar, Badge, Card, Progress, StatusPill, Th, Td, cn } from "@/components/ui";
import { SAMPLE_FIRM } from "@/lib/site-content";
import { Counter, Typing, useLoop } from "./anim";

// ── Chrome ───────────────────────────────────────────────────────────────────

const RAIL = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent", label: "AI Copilot", icon: Sparkles },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/compliance", label: "Compliance", icon: CalendarCheck2 },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/proposals", label: "Proposals", icon: FileSignature },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/invoices", label: "Invoices", icon: ReceiptIndianRupee },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/udin", label: "UDIN Register", icon: BadgeCheck },
  { href: "/dsc", label: "DSC Tracker", icon: KeyRound },
  { href: "/notices", label: "Notices", icon: AlertTriangle },
  { href: "/timesheets", label: "Timesheets", icon: Clock3 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

// ── Action cursor ────────────────────────────────────────────────────────────
//
// A pointer that travels to the control being described and clicks it, so a
// viewer can see *what* the automation is doing rather than inferring it from
// a state change. Screens drive it declaratively with `useCursor().move()`.

type CursorApi = { move: (selector: string | null, opts?: { click?: boolean }) => void };

const CursorCtx = React.createContext<CursorApi | null>(null);

/** Screens call this to walk the pointer through their own script. */
export function useCursor(): CursorApi | null {
  return React.useContext(CursorCtx);
}

/** Declarative cursor step for a screen: move to `selector`, optionally clicking. */
function useCursorScript(step: number, selector: string | null, click = false) {
  const cursor = useCursor();
  React.useEffect(() => {
    cursor?.move(selector, { click });
  }, [cursor, selector, click, step]);
}

function CursorPointer({ x, y, visible, clickSeq }: { x: number; y: number; visible: boolean; clickSeq: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-40"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        opacity: visible ? 1 : 0,
        transition: "transform .85s cubic-bezier(.22,1,.36,1), opacity .3s ease",
        willChange: "transform",
      }}
    >
      {clickSeq > 0 ? (
        <span
          key={clickSeq}
          className="absolute -left-3 -top-3 h-6 w-6 rounded-full border-2 border-green"
          style={{ animation: "cursor-ripple .6s cubic-bezier(.22,1,.36,1) both" }}
        />
      ) : null}
      <svg viewBox="0 0 20 22" className="h-[19px] w-[19px] drop-shadow-[0_2px_4px_rgba(25,32,28,0.35)]">
        <path d="M2 1.5 L2 17.5 L6.4 13.6 L9.2 20 L12.6 18.4 L9.8 12.2 L15.4 12.2 Z" fill="#ffffff" stroke="#19201c" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** The application shell, rebuilt at marketing scale. */
export function AppFrame({
  active = "/",
  firm = SAMPLE_FIRM,
  city = "Mumbai",
  badges = { documents: 0, compliance: 0, invoices: 0 },
  children,
  className,
}: {
  active?: string;
  firm?: string;
  city?: string;
  badges?: { documents?: number; compliance?: number; invoices?: number };
  children: React.ReactNode;
  className?: string;
}) {
  const today = "Sat, 18 Oct 2026";
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const lastSelector = React.useRef<string | null>(null);
  const [cursor, setCursor] = React.useState({ x: 60, y: 60, visible: false, clickSeq: 0 });

  const place = React.useCallback((selector: string | null, opts?: { click?: boolean }) => {
    lastSelector.current = selector;
    const frame = frameRef.current;
    if (!frame) return;
    if (!selector) {
      setCursor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }
    const target = frame.querySelector(selector);
    if (!target) return;
    const frameBox = frame.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    // Coordinates inside the frame are unscaled; getBoundingClientRect is not,
    // so divide by the live FitBox scale (1 when the frame is fluid).
    const scale = Number(getComputedStyle(frame).getPropertyValue("--fit-scale")) || 1;
    // The arrow's tip is the wrapper's origin, so centre it on the control.
    const x = (targetBox.left - frameBox.left) / scale + (targetBox.width / scale) / 2;
    const y = (targetBox.top - frameBox.top) / scale + (targetBox.height / scale) / 2;
    setCursor((prev) => ({ x, y, visible: true, clickSeq: opts?.click ? prev.clickSeq + 1 : prev.clickSeq }));
  }, []);

  const api = React.useMemo<CursorApi>(() => ({ move: place }), [place]);

  // Layout moves under the cursor (fonts, breakpoints, the fitted canvas), so
  // re-place the last target whenever the frame resizes.
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ro = new ResizeObserver(() => place(lastSelector.current));
    ro.observe(frame);
    return () => ro.disconnect();
  }, [place]);

  return (
    <div
      ref={frameRef}
      className={cn(
        // `min-w-0` keeps the frame from dragging its grid/flex parent out to the
        // min-content width of the widest table inside a scroll area.
        "relative min-w-0 overflow-hidden rounded-[26px] border border-black/[0.07] bg-canvas shadow-[0_40px_80px_-40px_rgba(25,32,28,0.35)]",
        className,
      )}
    >
      <CursorCtx.Provider value={api}>
      <div className="flex">
        <aside className="hidden w-[68px] shrink-0 flex-col items-center gap-1.5 border-r border-black/[0.05] bg-surface/70 py-3 md:flex">
          <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-green text-[11px] font-extrabold text-white">CA</span>
          {RAIL.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === active;
            const count = (badges as Record<string, number | undefined>)[item.href.replace("/", "")] ?? 0;
            return (
              <span
                key={item.href}
                className={cn("relative flex h-9 w-9 items-center justify-center rounded-2xl", isActive ? "bg-sage text-green" : "text-muted")}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={isActive ? 2.4 : 1.9} />
                {count > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C0503F] px-1 text-[9px] font-bold text-white">
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </span>
            );
          })}
          <span className="mt-auto flex h-9 w-9 items-center justify-center rounded-full bg-gold-soft text-[10px] font-extrabold text-gold">MP</span>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Every chip is nowrap + shrink-0 and the firm block takes the slack:
              in a narrow column the bar used to wrap into three lines and clip
              the firm name to "Verma & A…". The date chip only appears once the
              frame is genuinely wide. */}
          <header className="flex h-[54px] items-center gap-3 border-b border-black/[0.04] bg-canvas/80 px-4 backdrop-blur-xl">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold tracking-tight text-ink">{firm}</p>
              <p className="truncate text-[10px] text-muted">Practice intelligence · {city}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="hidden shrink-0 rounded-full border border-black/5 bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-muted xl:inline-flex">{today}</span>
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 text-[10px] font-bold text-muted">
                <Sparkles className="h-3.5 w-3.5 text-gold" /> AI
              </span>
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 text-[10px] font-semibold text-muted">
                <Target className="h-3 w-3" /> Search
              </span>
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/70 text-muted">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#C0503F]" />
              </span>
              <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-black/10 bg-white/70 py-1 pl-1 pr-3 sm:inline-flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-soft text-[9px] font-extrabold text-gold">MP</span>
                <span className="text-left leading-tight">
                  <span className="block text-[10px] font-bold text-ink">Managing Partner</span>
                  <span className="block text-[8px] font-semibold uppercase tracking-wide text-muted">Partner</span>
                </span>
              </span>
            </div>
          </header>
          <div className="p-3 sm:p-4">{children}</div>
        </div>
      </div>
      <CursorPointer {...cursor} />
      </CursorCtx.Provider>
    </div>
  );
}

function ScreenHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
        <h3 className="text-[15px] font-extrabold tracking-tight text-ink">{title}</h3>
      </div>
      {action}
    </div>
  );
}

/** App-style toast used to narrate what the automation just did. */
function Toast({ show, children, tone = "ink" }: { show: boolean; children: React.ReactNode; tone?: "ink" | "gold" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-2xl px-3 py-2 text-[11px] font-semibold shadow-[0_20px_40px_-20px_rgba(25,32,28,0.6)] transition-all duration-500",
        tone === "gold" ? "bg-gold text-white" : "bg-ink text-white",
        show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

/** Drives a screen with its own loop — used by the use-case sections. */
export function LoopPlayer({
  steps,
  interval,
  children,
}: {
  steps: number;
  interval: number;
  children: (step: number) => React.ReactNode;
}) {
  const { ref, step } = useLoop(steps, interval);
  return (
    <div ref={ref} className="relative">
      {children(step)}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardScreen({ step = 3 }: { step?: number }) {
  useCursorScript(step, step >= 1 ? '[data-cursor="ai"]' : null, step === 1);
  const focus = [
    { client: "Apex Media Pvt Ltd", work: "GSTR-3B · October", status: "Pending", due: "3d left", tone: "text-[#B98028]" },
    { client: "Aurora Textiles LLP", work: "TDS 26Q · Q2", status: "Overdue", due: "2d late", tone: "text-[#C0503F]" },
    { client: "Krishna Agro Exports", work: "ITR-6 · AY 2026-27", status: "In Progress", due: "9d left", tone: "text-muted" },
  ];
  return (
    <div className="relative">
      <ScreenHead eyebrow="Command centre" title="Good morning, Managing Partner" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Filings due" value={<Counter to={7} />} hint="this week" tone="sage" icon={<CalendarCheck2 className="h-4 w-4" />} />
        <Kpi label="Overdue fees" value={<Counter to={2.62} decimals={2} prefix="₹" suffix=" L" />} hint="4 clients" tone="rose" icon={<Wallet className="h-4 w-4" />} />
        <Kpi label="Documents" value={<Counter to={9} />} hint="awaiting clients" tone="gold" icon={<FolderOpen className="h-4 w-4" />} />
        <Kpi label="Realisation" value={<Counter to={68} suffix="%" />} hint="this quarter" tone="blue" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Today&rsquo;s focus</p>
            <Badge tone="red">2 overdue</Badge>
          </div>
          <div className="space-y-1.5">
            {focus.map((row, i) => (
              <div
                key={row.client}
                className="flex items-center gap-2.5 rounded-2xl border border-black/[0.05] bg-subtle/70 px-3 py-2"
                style={{
                  opacity: i <= step ? 1 : 0,
                  transform: i <= step ? "none" : "translateX(-8px)",
                  transition: "opacity .5s ease, transform .5s cubic-bezier(.22,1,.36,1)",
                }}
              >
                <Avatar name={row.client} className="h-7 w-7" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold text-ink">{row.client}</p>
                  <p className="truncate text-[10px] text-muted">{row.work}</p>
                </div>
                <span className={cn("hidden text-[10px] font-bold sm:block", row.tone)}>{row.due}</span>
                <StatusPill status={row.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-2 p-3.5" data-cursor="ai">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <Sparkles className="h-3.5 w-3.5 text-gold" /> AI practice brief
          </p>
          <p className="text-[11px] leading-relaxed text-ink">
            <Typing
              text="₹2.62 L is stuck with 4 clients past 30 days; TDS 26Q for Aurora Textiles is 2 days late. Clear those two before Friday's ROC batch."
              speed={14}
            />
          </p>
          <div className="mt-auto flex items-center gap-2 text-[10px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-green" /> Answered from your own compliance and invoice records
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  tone: "sage" | "gold" | "blue" | "rose";
}) {
  const tones = {
    sage: "bg-sage text-sage-ink",
    gold: "bg-gold-soft text-gold",
    blue: "bg-[#E9F0F9] text-[#335C8A]",
    rose: "bg-[#FBEAE7] text-[#A33B2E]",
  };
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
          <p className="mt-1.5 text-[20px] font-extrabold leading-none tracking-tight text-ink">{value}</p>
          <p className="mt-1.5 truncate text-[10px] text-muted">{hint}</p>
        </div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl", tones[tone])}>{icon}</span>
      </div>
    </Card>
  );
}

// ── Leads ────────────────────────────────────────────────────────────────────

export function LeadsScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 2 ? '[data-cursor="lead-whatsapp"]' : null, step === 2);
  const leads = [
    { name: "Rohan Mehta", company: "Mehta Logistics", source: "Website", score: 86, category: "Hot", status: step >= 2 ? "Contacted" : "New" },
    { name: "Priya Nair", company: "Nair Interiors", source: "Referral", score: 74, category: "Warm", status: "New" },
    { name: "Imran Sheikh", company: "Sheikh Foods", source: "WhatsApp", score: 61, category: "Warm", status: "New" },
    { name: "Anita Rao", company: "Rao Pharma", source: "Website", score: 38, category: "Cold", status: "New" },
  ];
  return (
    <div className="relative">
      <ScreenHead
        eyebrow="Growth"
        title="Leads this week"
        action={
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-green px-3 text-[11px] font-semibold text-white">
            <Plus className="h-3.5 w-3.5" /> New lead
          </span>
        }
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="bg-subtle/60">
                <Th>Enquiry</Th>
                <Th>Source</Th>
                <Th>Score</Th>
                <Th>Stage</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, i) => (
                <tr
                  key={lead.company}
                  className={cn("border-t border-black/[0.04]", step >= 2 && i === 0 && "bg-sage/40")}
                  style={{ opacity: i <= step + 1 ? 1 : 0.25, transition: "opacity .5s ease, background .5s ease" }}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={lead.name} className="h-7 w-7" />
                      <div>
                        <p className="text-[12px] font-bold">{lead.name}</p>
                        <p className="text-[10px] text-muted">{lead.company}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-[11px] text-muted">{lead.source}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Progress value={lead.score} tone={lead.score > 80 ? "green" : lead.score > 60 ? "amber" : "red"} />
                      <span className="text-[11px] font-bold">{lead.score}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={lead.status} />
                      <StatusPill status={lead.category} />
                    </div>
                  </Td>
                  <Td>
                    <span
                      data-cursor={i === 0 ? "lead-whatsapp" : undefined}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-[#E8F2EA] px-2.5 text-[10px] font-bold text-[#2F6B3F]"
                    >
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Toast show={step >= 2}>Follow-up logged · routed to the manager</Toast>
    </div>
  );
}

// ── Proposal ─────────────────────────────────────────────────────────────────

export function ProposalScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 2 ? '[data-cursor="proposal-send"]' : null, step === 2);
  const lines = [
    { label: "GST retainer · monthly", value: "₹18,000" },
    { label: "TDS returns · quarterly", value: "₹9,000" },
    { label: "Books review · monthly", value: "₹12,000" },
  ];
  return (
    <div className="relative">
      <ScreenHead
        eyebrow="Proposals"
        title="Mehta Logistics · GST + TDS retainer"
        action={<StatusPill status={step >= 2 ? "Sent" : "Draft"} />}
      />
      <div className="grid gap-2.5 lg:grid-cols-[1fr_1fr]">
        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Fee schedule</p>
          <div className="mt-2 space-y-1.5">
            {lines.map((line, i) => (
              <div
                key={line.label}
                className="flex items-center justify-between text-[12px]"
                style={{ opacity: i <= step ? 1 : 0, transform: i <= step ? "none" : "translateY(6px)", transition: "all .5s cubic-bezier(.22,1,.36,1)" }}
              >
                <span className="text-muted">{line.label}</span>
                <span className="font-bold text-ink">{line.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 space-y-1.5 border-t border-black/[0.06] pt-2.5 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Professional fees</span>
              <Counter to={39000} prefix="₹" className="font-extrabold" />
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>GST @ 18% (CGST 9% + SGST 9%)</span>
              <Counter to={7020} prefix="₹" />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-extrabold">Total</span>
              <Counter to={46020} prefix="₹" className="font-extrabold text-green" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span
              data-cursor="proposal-send"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-green px-3 text-[11px] font-semibold text-white"
            >
              <Send className="h-3.5 w-3.5" /> Send on WhatsApp
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-semibold text-ink">
              Email proposal
            </span>
          </div>
        </Card>

        <Card className={cn("p-3.5 transition-all duration-700", step >= 1 ? "opacity-100" : "translate-y-2 opacity-0")}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[12px] font-extrabold">{SAMPLE_FIRM}</p>
              <p className="text-[9px] text-muted">Chartered Accountants · Mumbai</p>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-green text-[9px] font-extrabold text-white">CA</span>
          </div>
          <p className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Scope of engagement</p>
          <ul className="mt-1.5 space-y-1 text-[11px] text-ink">
            {["Monthly GSTR-1 & 3B filing", "Quarterly TDS returns (26Q)", "Annual ITR with computation", "Books review and MIS every month"].map((item, i) => (
              <li key={item} className="flex items-center gap-1.5" style={{ opacity: i + 1 <= step + 1 ? 1 : 0.2, transition: "opacity .4s ease" }}>
                <Check className="h-3 w-3 text-green" /> {item}
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-black/[0.06] pt-2 text-[10px] text-muted">
            Valid for 15 days · Payment on receipt of GST invoice
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted">For the firm · Signatory</span>
            <Badge tone="sage">Auto-numbered PRO-2026-018</Badge>
          </div>
        </Card>
      </div>
      <Toast show={step >= 2}>Proposal sent · WhatsApp + email logged</Toast>
    </div>
  );
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export function OnboardingScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 1 ? '[data-cursor="client-gstin"]' : null, step === 1);
  return (
    <div className="relative">
      <ScreenHead eyebrow="Clients" title="Onboarding Mehta Logistics" action={<Badge tone="green">Client record created</Badge>} />
      <div className="grid gap-2.5 lg:grid-cols-[1.15fr_1fr]">
        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Entity details</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <MockField label="Client name" value="Mehta Logistics Pvt Ltd" />
            <MockField label="Contact person" value="Rohan Mehta" />
            <MockField label="Entity type" value="Private Limited" />
            <MockField label="City / State" value="Thane, Maharashtra" />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div data-cursor="client-gstin">
              <MockField label="GSTIN" value="27AAFCM1••••1Z5" locked />
            </div>
            <MockField label="PAN" value="AAFCM••••K" locked />
          </div>
          <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-sage px-3 py-2 text-[10px] font-semibold text-sage-ink">
            <ShieldCheck className="h-3.5 w-3.5" /> PAN and GSTIN are encrypted at rest (AES-256-GCM) and never shown to article staff
          </div>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Onboarding checklist</p>
          <div className="mt-2 space-y-1.5">
            {[
              { label: "KYC documents uploaded", meta: "6 files · verified" },
              { label: "Engagement letter signed", meta: "PRO-2026-018" },
              { label: "Compliance calendar seeded", meta: "11 filings this FY" },
              { label: "GST portal credentials stored", meta: "encrypted" },
              { label: "First invoice raised", meta: "auto on approval" },
            ].map((item, i) => (
              <div
                key={item.label}
                className="flex items-center gap-2.5 rounded-2xl border border-black/[0.05] bg-subtle/70 px-3 py-2"
                style={{ opacity: i <= step + 1 ? 1 : 0.25, transform: i <= step + 1 ? "none" : "translateX(6px)", transition: "opacity .5s ease, transform .5s cubic-bezier(.22,1,.36,1)" }}
              >
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", i <= step + 1 ? "bg-green text-white" : "bg-black/[0.08] text-muted")}>
                  <Check className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold text-ink">{item.label}</p>
                  <p className="truncate text-[10px] text-muted">{item.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MockField({ label, value, locked = false }: { label: string; value: string; locked?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-black/10 bg-white px-3 py-2">
        <span className="truncate text-[12px] font-semibold text-ink">{value}</span>
        {locked ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green" /> : null}
      </div>
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

export function DocumentsScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 2 ? '[data-cursor="chase"]' : null, step === 2);
  const rows = [
    { client: "Apex Media Pvt Ltd", doc: "Bank statement · Sep", waiting: "6 days", progress: step >= 1 ? 100 : 62 },
    { client: "Aurora Textiles LLP", doc: "Purchase register · Sep", waiting: "4 days", progress: step >= 1 ? 100 : 28 },
    { client: "Krishna Agro Exports", doc: "Sale invoices · Q2", waiting: "3 days", progress: 44 },
    { client: "Reva Design Studio", doc: "Form 16A copies", waiting: "1 day", progress: step >= 2 ? 100 : 12 },
  ];
  return (
    <div className="relative">
      <ScreenHead
        eyebrow="Document desk"
        title="Requests &amp; reminders"
        action={
          <span
            data-cursor="chase"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-semibold text-ink"
          >
            <Send className="h-3.5 w-3.5" /> Chase all
          </span>
        }
      />
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Awaiting clients</p>
          <Badge tone="amber">{step >= 2 ? "4 reminders sent" : "4 pending"}</Badge>
        </div>
        <div className="space-y-1.5">
          {rows.map((row, i) => {
            const done = row.progress >= 100;
            return (
              <div key={row.doc} className="rounded-2xl border border-black/[0.05] bg-subtle/70 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={row.client} className="h-7 w-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-ink">{row.doc}</p>
                    <p className="truncate text-[10px] text-muted">
                      {row.client} · waiting {row.waiting}
                    </p>
                  </div>
                  <StatusPill status={done ? "Verified" : "Pending"} />
                </div>
                <div className="mt-2">
                  <Progress value={row.progress} tone={done ? "green" : i === 1 ? "amber" : "red"} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Toast show={step >= 2} tone="gold">
        WhatsApp reminder sent to 4 clients · next chase in 48 hours
      </Toast>
    </div>
  );
}

// ── Compliance ───────────────────────────────────────────────────────────────

export function ComplianceScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 1 ? '[data-cursor="filed"]' : null, step === 1);
  const rows = [
    { client: "Apex Media Pvt Ltd", filing: "GSTR-3B · Oct 2026", due: "20 Oct", left: "2d", tone: "text-[#C0503F]", status: step >= 1 ? "Filed" : "Pending", owner: "Sneha Kulkarni" },
    { client: "Aurora Textiles LLP", filing: "TDS 26Q · Q2", due: "18 Oct", left: "due today", tone: "text-[#C0503F]", status: "In Progress", owner: "Arjun Iyer" },
    { client: "Krishna Agro Exports", filing: "ITR-6 · AY 2026-27", due: "31 Oct", left: "13d", tone: "text-[#B98028]", status: "In Progress", owner: "Sneha Kulkarni" },
    { client: "Reva Design Studio", filing: "ROC AOC-4 · FY25", due: "30 Oct", left: "12d", tone: "text-[#B98028]", status: "Pending", owner: "Neha Gupta" },
    { client: "Sunrise Hospitals", filing: "GSTR-9 · FY25", due: "31 Dec", left: "74d", tone: "text-muted", status: "Pending", owner: "Arjun Iyer" },
  ];
  return (
    <div className="relative">
      <ScreenHead eyebrow="Compliance" title="Statutory calendar" action={<Badge tone="green">{step >= 1 ? "19 of 24 filed" : "18 of 24 filed"}</Badge>} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="bg-subtle/60">
                <Th>Client</Th>
                <Th>Filing</Th>
                <Th>Due</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.filing} className="border-t border-black/[0.04]">
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={row.client} className="h-7 w-7" />
                      <span className="text-[12px] font-bold">{row.client}</span>
                    </div>
                  </Td>
                  <Td className="text-[11px]">{row.filing}</Td>
                  <Td>
                    <span className="block text-[11px] font-semibold">{row.due}</span>
                    <span className={cn("block text-[10px] font-bold", row.tone)}>{row.left}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Avatar name={row.owner} className="h-6 w-6 text-[9px]" />
                      <span className="hidden text-[11px] text-muted sm:block">{row.owner.split(" ")[0]}</span>
                    </div>
                  </Td>
                  <Td>
                    <span data-cursor={row.filing.startsWith("GSTR-3B") ? "filed" : undefined}>
                      <StatusPill status={row.status} />
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 border-t border-black/[0.05] bg-subtle/40 px-4 py-2.5">
          <div className="w-40">
            <Progress value={step >= 1 ? 79 : 75} />
          </div>
          <p className="text-[10px] text-muted">Filed this quarter · deadline-first ordering, overdue items pinned to the top</p>
        </div>
      </Card>
      <Toast show={step >= 1}>GSTR-3B marked filed · acknowledgement stored against Apex Media</Toast>
    </div>
  );
}

// ── Notices & UDIN ───────────────────────────────────────────────────────────

export function NoticeScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 3 ? '[data-cursor="udin"]' : null, step === 3);
  const draft = [
    "Acknowledgement of ASMT-10 dated 06 Oct 2026, reference GST/ASMT/44821.",
    "Period-wise reconciliation of ITC as per the 2B for FY 2024-25.",
    "Documents enclosed: purchase register, 2B summary, supplier confirmations.",
    "Legal basis to be verified by the CA before submission.",
  ];
  return (
    <div className="relative">
      <ScreenHead
        eyebrow="Notices"
        title="GST ASMT-10 · Aurora Textiles LLP"
        action={<StatusPill status={step >= 3 ? "Response Filed" : "Open"} />}
      />
      <div className="grid gap-2.5 lg:grid-cols-[1fr_1.1fr]">
        <Card className="p-3.5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Notice record</p>
              <p className="mt-1 text-[12px] font-bold text-ink">Portal · GST</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FBEAE7] px-2.5 py-1 text-[10px] font-bold text-[#A33B2E]">
              <AlertTriangle className="h-3 w-3" /> 2 days left
            </span>
          </div>
          <dl className="mt-2 space-y-1.5 text-[11px]">
            {[
              ["Received", "06 Oct 2026"],
              ["Response due", "20 Oct 2026"],
              ["Amount in question", "₹1,42,500"],
              ["Reference", "GST/ASMT/44821"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-sage px-3 py-2 text-[10px] font-semibold text-sage-ink">
            <Clock3 className="h-3.5 w-3.5" /> Escalation policy: alert the partner at 3 days, again at 24 hours
          </div>
        </Card>

        <Card className="p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <Sparkles className="h-3.5 w-3.5 text-gold" /> Draft reply · AI assisted
          </p>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink">
            {draft.map((line, i) => (
              <li
                key={line}
                className="flex gap-1.5"
                style={{ opacity: i <= step + 1 ? 1 : 0, transform: i <= step + 1 ? "none" : "translateY(5px)", transition: "all .45s cubic-bezier(.22,1,.36,1)" }}
              >
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-green opacity-60" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 rounded-2xl border border-dashed border-black/10 bg-subtle/60 px-3 py-2 text-[10px] font-semibold text-muted">
            Draft only — the CA verifies the legal basis before filing.
          </div>
          <div
            className="mt-2.5 flex flex-wrap items-center gap-2 transition-all duration-700"
            style={{ opacity: step >= 3 ? 1 : 0.35 }}
          >
            <span data-cursor="udin">
              <Badge tone="sage">
                <BadgeCheck className="h-3 w-3" /> UDIN AA123456789012345678
              </Badge>
            </span>
            <Badge tone="blue">Response uploaded to portal</Badge>
          </div>
        </Card>
      </div>
      <Toast show={step >= 3}>Response filed · UDIN logged in the register</Toast>
    </div>
  );
}

// ── Collections ──────────────────────────────────────────────────────────────

export function CollectionsScreen({ step = 2 }: { step?: number }) {
  const rows = [
    { id: "INV-2026-012", client: "Krishna Agro Exports", amount: 118000, late: "48 days late", due: "31 Aug", paid: false },
    { id: "INV-2026-019", client: "Aurora Textiles LLP", amount: 85000, late: "31 days late", due: "17 Sep", paid: false },
    { id: "INV-2026-024", client: "Apex Media Pvt Ltd", amount: 59000, late: "22 days late", due: "26 Sep", paid: step >= 2 },
    { id: "INV-2026-031", client: "Reva Design Studio", amount: 24000, late: "9 days late", due: "09 Oct", paid: false },
  ];
  const outstanding = step >= 2 ? 250000 : 309000;
  useCursorScript(step, step >= 1 ? '[data-cursor="collect-remind"]' : null, step === 1);
  return (
    <div className="relative">
      <ScreenHead
        eyebrow="Fee recovery"
        title="Invoices &amp; collections"
        action={
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-semibold text-ink">
            <Wallet className="h-3.5 w-3.5" /> Export CSV
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Billed" value={<Counter to={5.53} decimals={2} prefix="₹" suffix=" L" />} hint="this year" tone="sage" icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Kpi label="Collected" value={<Counter to={step >= 2 ? 3.03 : 2.44} decimals={2} prefix="₹" suffix=" L" />} hint="avg 41 days" tone="blue" icon={<Wallet className="h-4 w-4" />} />
        <Kpi label="Outstanding" value={<Counter to={outstanding / 100000} decimals={2} prefix="₹" suffix=" L" />} hint="9 invoices" tone="gold" icon={<Clock3 className="h-4 w-4" />} />
        <Kpi label="Overdue" value={<Counter to={step >= 2 ? 2.03 : 2.62} decimals={2} prefix="₹" suffix=" L" />} hint="4 clients" tone="rose" icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <Card className="mt-2.5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="bg-subtle/60">
                <Th>Invoice</Th>
                <Th>Balance</Th>
                <Th>Aging</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={cn("border-t border-black/[0.04] transition-colors duration-500", row.paid && "bg-sage/40")}>
                  <Td>
                    <p className="text-[12px] font-bold">{row.id}</p>
                    <p className="text-[10px] text-muted">{row.client}</p>
                  </Td>
                  <Td className="text-[12px] font-bold">{row.paid ? "₹0" : `₹${row.amount.toLocaleString("en-IN")}`}</Td>
                  <Td className={cn("text-[11px] font-semibold", row.paid ? "text-muted" : "text-[#C0503F]")}>{row.paid ? "—" : row.late}</Td>
                  <Td>
                    <StatusPill status={row.paid ? "Paid" : "Overdue"} />
                  </Td>
                  <Td>
                    {row.paid ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#2F6B3F]">
                        <CheckCircle2 className="h-3.5 w-3.5" /> UPI settled
                      </span>
                    ) : (
                      <span
                        data-cursor={row.id === "INV-2026-012" ? "collect-remind" : undefined}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-[#E8F2EA] px-2.5 text-[10px] font-bold text-[#2F6B3F]"
                      >
                        <MessageCircle className="h-3 w-3" /> Remind
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Toast show={step >= 2}>₹59,000 received · INV-2026-024 closed automatically</Toast>
    </div>
  );
}

// ── AI Copilot ───────────────────────────────────────────────────────────────

export function CopilotScreen({ step = 3 }: { step?: number }) {
  useCursorScript(step, step >= 4 ? '[data-cursor="copilot-approve"]' : null, step === 4);
  const tools = [
    { name: "list_deadlines", meta: "7 filings · next 7 days" },
    { name: "list_pending_documents", meta: "9 requests · 4 clients" },
    { name: "list_overdue_invoices", meta: "₹2.62 L · 48 days max" },
  ];
  const reply = [
    "**Aurora Textiles** — TDS 26Q is 2 days late. Owner: Arjun.",
    "**Apex Media** — GSTR-3B due in 2 days; bank statement still pending.",
    "**₹2.62 L** overdue across 4 clients; Krishna Agro is 48 days late.",
    "Suggested first move: file the 26Q today, then chase the two documents.",
  ];
  return (
    <div className="relative">
      <ScreenHead eyebrow="AI Copilot" title="Ask anything about the practice" action={<Badge tone="sage">{step >= 4 ? "Approved" : "Proposal"}</Badge>} />
      <Card className="p-3.5">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-green px-3 py-2 text-[11px] font-semibold text-white">
            Which deadlines need my attention this week?
          </p>
        </div>

        <div className="mt-2.5 flex gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sage text-sage-ink">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-black/[0.06] bg-subtle/70 px-3 py-2">
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {tools.map((tool, i) => {
                const done = step > i;
                return (
                  <span
                    key={tool.name}
                    className={cn("inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[9px] font-bold", done ? "text-[#2F6B3F]" : "text-muted")}
                    style={{ opacity: step >= i ? 1 : 0.25, transition: "opacity .4s ease" }}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                    {tool.name}
                    <span className="font-medium text-muted">· {tool.meta}</span>
                  </span>
                );
              })}
            </div>
            <div className="space-y-1 text-[11px] leading-relaxed text-ink">
              {reply.map((line, i) => (
                <p
                  key={line}
                  style={{ opacity: step >= 2 + Math.min(i, 1) ? 1 : 0, transform: step >= 2 ? "none" : "translateY(4px)", transition: "opacity .5s ease, transform .5s cubic-bezier(.22,1,.36,1)" }}
                >
                  {line.split("**").map((part, j) => (j % 2 === 1 ? <strong key={j} className="font-extrabold">{part}</strong> : <span key={j}>{part}</span>))}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div
          className="mt-2.5 rounded-2xl border border-gold/30 bg-gold-soft/70 px-3 py-2.5"
          style={{ opacity: step >= 3 ? 1 : 0, transform: step >= 3 ? "none" : "translateY(8px)", transition: "all .6s cubic-bezier(.22,1,.36,1)" }}
        >
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
            <ShieldCheck className="h-3.5 w-3.5" /> Prepared for approval
          </p>
          <p className="mt-1 text-[12px] font-bold text-ink">Compliance task — file TDS 26Q for Aurora Textiles today</p>
          <p className="text-[10px] text-muted">Nothing is written until you approve it. Every approval is recorded in the audit trail.</p>
          <div className="mt-2 flex gap-2">
            <span
              data-cursor="copilot-approve"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full px-3 text-[10px] font-bold transition-all duration-500",
                step >= 4 ? "bg-green text-white" : "bg-white text-ink",
              )}
            >
              {step >= 4 ? <Check className="h-3 w-3" /> : null} Approve
            </span>
            <span className="inline-flex h-7 items-center rounded-full border border-black/10 bg-white px-3 text-[10px] font-bold text-muted">Dismiss</span>
          </div>
        </div>
      </Card>
      <Toast show={step >= 4}>Task created and assigned · audit entry #4821</Toast>
    </div>
  );
}

// ── Client 360 (used in the workflow's final beat) ───────────────────────────

export function ClientScreen({ step = 2 }: { step?: number }) {
  useCursorScript(step, step >= 2 ? '[data-cursor="client-whatsapp"]' : null, step === 2);
  return (
    <div className="relative">
      <ScreenHead eyebrow="Clients" title="Apex Media Pvt Ltd" action={<Badge tone="green">Relationship 3.2 yrs</Badge>} />
      <div className="grid gap-2.5 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-3.5">
          <div className="flex items-center gap-2.5">
            <Avatar name="Apex Media Pvt Ltd" className="h-10 w-10" />
            <div>
              <p className="text-[12px] font-bold text-ink">Farah Khan · Director</p>
              <p className="text-[10px] text-muted">Private Limited · Thane, Maharashtra</p>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
            {[
              ["Billed", "₹4.20 L"],
              ["Outstanding", "₹59,000"],
              ["Open filings", "2"],
              ["Documents pending", "1"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-subtle/70 px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{k}</p>
                <p className="mt-0.5 text-[12px] font-extrabold text-ink">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <span
              data-cursor="client-whatsapp"
              className="inline-flex h-7 items-center gap-1 rounded-full bg-[#E8F2EA] px-2.5 text-[10px] font-bold text-[#2F6B3F]"
            >
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </span>
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 text-[10px] font-bold text-ink">
              <Send className="h-3 w-3" /> Email
            </span>
          </div>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">One timeline, every interaction</p>
          <ol className="mt-2 space-y-1.5">
            {[
              { when: "Today", what: "GSTR-3B prepared, awaiting partner approval", icon: CalendarCheck2 },
              { when: "12 Oct", what: "Invoice INV-2026-024 raised · ₹59,000", icon: ReceiptIndianRupee },
              { when: "08 Oct", what: "Bank statement received and verified", icon: FolderOpen },
              { when: "02 Oct", what: "Consultation call logged by Priya · 35 min", icon: Clock3 },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.what}
                  className="flex items-start gap-2.5"
                  style={{ opacity: i <= step + 1 ? 1 : 0.25, transform: i <= step + 1 ? "none" : "translateX(6px)", transition: "all .5s cubic-bezier(.22,1,.36,1)" }}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-sage text-sage-ink">
                    <Icon className="h-3 w-3" />
                  </span>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{item.when}</p>
                    <p className="text-[11px] text-ink">{item.what}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
