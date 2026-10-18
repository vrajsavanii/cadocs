"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  CalendarCheck2,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  FileSignature,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ReceiptIndianRupee,
  Send,
  Settings,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { cn } from "./ui";
import { SearchDialog } from "./interactive";

export type NavCounts = {
  documents: number;
  compliance: number;
  leads: number;
  invoices: number;
  agent: number;
};

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, badge: null },
  { href: "/agent", label: "AI Copilot", icon: Sparkles, badge: "agent" },
  { href: "/documents", label: "Documents", icon: FolderOpen, badge: "documents" },
  { href: "/compliance", label: "Compliance", icon: CalendarCheck2, badge: "compliance" },
  { href: "/leads", label: "Leads", icon: Target, badge: "leads" },
  { href: "/proposals", label: "Proposals", icon: FileSignature, badge: null },
  { href: "/campaigns", label: "Campaigns", icon: Send, badge: null },
  { href: "/invoices", label: "Invoices", icon: ReceiptIndianRupee, badge: "invoices" },
  { href: "/clients", label: "Clients", icon: Users, badge: null },
  { href: "/udin", label: "UDIN Register", icon: BadgeCheck, badge: null },
  { href: "/dsc", label: "DSC Tracker", icon: KeyRound, badge: null },
  { href: "/notices", label: "Notices", icon: AlertTriangle, badge: null },
  { href: "/timesheets", label: "Timesheets", icon: Clock3, badge: null },
  { href: "/reports", label: "Reports", icon: BarChart3, badge: null },
  { href: "/settings", label: "Settings", icon: Settings, badge: null },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const SIDEBAR_KEY = "ca:sidebar-expanded";

export function Sidebar({ counts, firmName }: { counts: NavCounts; firmName: string }) {
  const pathname = usePathname();
  // The server always renders the collapsed rail; the saved preference is
  // applied after mount so hydration never mismatches.
  const [expanded, setExpanded] = React.useState(false);
  const logo = firmName
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  React.useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_KEY) === "1") setExpanded(true);
  }, []);

  // Keep the content offset in sync so the wider rail never covers the page.
  React.useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", expanded ? "224px" : "100px");
  }, [expanded]);

  function toggle() {
    setExpanded((v) => {
      const next = !v;
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden h-dvh flex-col p-4 transition-[width] duration-200 ease-out lg:flex",
        expanded ? "w-[224px]" : "w-[100px]",
      )}
    >
      <div
        className={cn(
          "flex h-full flex-col gap-1 rounded-[34px] border border-black/5 bg-white py-5 shadow-[0_18px_50px_-24px_rgba(25,32,28,0.35)] transition-[width] duration-200 ease-out",
          expanded ? "w-full items-stretch px-2" : "w-[68px] items-center",
        )}
      >
        <div className={cn("mb-3 flex items-center", expanded ? "w-full gap-2 px-1" : "flex-col gap-2")}>
          <Link
            href="/"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-green text-[11px] font-extrabold tracking-tight text-white",
              expanded && "flex-1",
            )}
            aria-label={firmName}
          >
            {logo || "CA"}
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-muted transition hover:border-black/20 hover:text-ink"
          >
            {expanded ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
          </button>
        </div>
        <nav
          className={cn(
            "flex flex-1 flex-col gap-1 overflow-y-auto",
            expanded ? "w-full items-stretch" : "items-center",
          )}
        >
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const badge = item.badge ? counts[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={expanded ? undefined : item.label}
                className={cn(
                  "group relative flex h-10 items-center rounded-2xl transition-all duration-150",
                  expanded ? "w-full gap-3 px-3" : "w-10 justify-center",
                  active ? "bg-sage text-green" : "text-muted hover:bg-subtle hover:text-ink",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.4 : 1.9} />
                {expanded ? (
                  <span className="truncate text-[12px] font-bold tracking-tight">{item.label}</span>
                ) : null}
                {badge > 0 ? (
                  <span
                    className={cn(
                      "absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C0503F] px-1 text-[9px] font-bold text-white",
                      expanded ? "right-2 top-1.5" : "-right-0.5 -top-0.5",
                    )}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
                {expanded ? null : (
                  <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className={cn("mt-2 flex", expanded ? "w-full items-center px-1" : "justify-center")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[10px] font-extrabold text-gold">
            MP
          </div>
        </div>
      </div>
    </aside>
  );
}

function SignOutButton({ userName }: { userName: string }) {
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      title={`Sign out ${userName}`}
      className="flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 text-[11px] font-bold text-muted transition hover:text-ink disabled:opacity-60"
    >
      <LogOut className="h-3.5 w-3.5" /> Sign out
    </button>
  );
}

const ROLE_LABEL: Record<string, string> = {
  partner: "Partner",
  manager: "Manager",
  article: "Article assistant",
};

export function Topbar({
  firmName,
  city,
  user,
}: {
  firmName: string;
  city: string;
  user?: { name: string; role: string };
}) {
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const initials = (user?.name ?? "MP")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.04] bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center gap-3 px-4 md:px-8">
        <Link href="/" className="mr-1 flex items-center gap-2 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-green text-[10px] font-extrabold text-white">CA</span>
        </Link>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-extrabold tracking-tight text-ink">{firmName}</p>
          <p className="truncate text-[11px] text-muted">Practice intelligence · {city}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-full border border-black/5 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-muted md:inline-flex">
            {today}
          </span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("ca:ai-open"))}
            title="Practice AI (⌘J)"
            className="flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 text-[11px] font-bold text-muted transition hover:text-ink"
          >
            <Sparkles className="h-3.5 w-3.5 text-gold" /> AI
            <kbd className="hidden rounded bg-black/5 px-1 text-[9px] font-semibold text-muted md:inline">⌘J</kbd>
          </button>
          <SearchDialog />
          <Link
            href="/notices"
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/70 text-muted transition hover:text-ink"
            aria-label="Notices"
          >
            <AlertTriangle className="h-4 w-4" />
          </Link>
          {user ? (
            <span
              className="hidden items-center gap-2 rounded-full border border-black/10 bg-white/70 py-1 pl-1 pr-3 sm:inline-flex"
              title={ROLE_LABEL[user.role] ?? user.role}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-soft text-[10px] font-extrabold text-gold">
                {initials}
              </span>
              <span className="text-left leading-tight">
                <span className="block max-w-[130px] truncate text-[11px] font-bold text-ink">{user.name}</span>
                <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
                  {ROLE_LABEL[user.role] ?? user.role}
                </span>
              </span>
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-soft text-[11px] font-extrabold text-gold">MP</span>
          )}
          {user ? <SignOutButton userName={user.name} /> : null}
        </div>
      </div>
    </header>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const primary = NAV;
  return (
    <div className="sticky top-[68px] z-20 overflow-x-auto border-b border-black/[0.04] bg-canvas/80 px-3 py-2 backdrop-blur-xl lg:hidden">
      <nav className="flex w-max items-center gap-1.5">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition",
                active ? "bg-green text-white" : "bg-white/70 text-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
