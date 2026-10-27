"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarCheck2,
  ChevronsLeft,
  ListChecks,
  ChevronsRight,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  ReceiptIndianRupee,
  Settings,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "./ui";
import { SearchDialog } from "./interactive";
import { COPILOT_HREF, NAV_SECTIONS, SETTINGS_HREF, sectionFor } from "@/lib/nav";

export type NavCounts = {
  documents: number;
  workflow: number;
  compliance: number;
  leads: number;
  invoices: number;
  agent: number;
  automation: number;
};

/**
 * The rail shows the whole software again: the six moves of a working day, and
 * inside each move every screen it contains. Nothing is hidden behind a group —
 * collapsed, the rail is eight icons; expanded, it lists all sixteen modules in
 * the order the work happens, so a partner coming from the old version finds
 * every familiar tab exactly where they left it.
 */
const SECTION_ICONS = {
  today: LayoutDashboard,
  workflow: ListChecks,
  compliance: CalendarCheck2,
  documents: FolderOpen,
  clients: Users,
  fees: ReceiptIndianRupee,
  automation: Zap,
  grow: Target,
} as const;

const SECTION_BADGES: Record<string, keyof NavCounts | null> = {
  today: null,
  workflow: "workflow",
  compliance: "compliance",
  documents: "documents",
  clients: null,
  fees: "invoices",
  automation: "automation",
  grow: "leads",
};

type RailItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge: keyof NavCounts | null;
  children: { href: string; label: string; hint: string }[];
};

const RAIL: RailItem[] = [
  { href: "/", label: "My day", icon: LayoutDashboard, badge: null, children: [] },
  { href: COPILOT_HREF, label: "Copilot", icon: Sparkles, badge: "agent", children: [] },
  ...NAV_SECTIONS.filter((section) => section.key !== "today").map((section) => ({
    href: section.href,
    label: section.label,
    icon: SECTION_ICONS[section.key],
    badge: SECTION_BADGES[section.key] ?? null,
    children: section.tabs.map((tab) => ({ href: tab.href, label: tab.label, hint: tab.hint })),
  })),
];

/** A rail item is active for every route inside its section (e.g. /notices → Compliance). */
function isActive(pathname: string, href: string) {
  if (href === COPILOT_HREF) return pathname === COPILOT_HREF || pathname.startsWith(`${COPILOT_HREF}/`);
  if (href === SETTINGS_HREF) return pathname === SETTINGS_HREF || pathname.startsWith(`${SETTINGS_HREF}/`);
  if (href === "/") return pathname === "/";
  return sectionFor(pathname)?.href === href;
}

const SIDEBAR_KEY = "ca:sidebar-expanded";
const SIDEBAR_WIDTH = "236px";

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
    document.documentElement.style.setProperty("--sidebar-w", expanded ? SIDEBAR_WIDTH : "100px");
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
        expanded ? "w-[236px]" : "w-[100px]",
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
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar to see every module"}
            title={expanded ? "Collapse sidebar" : "Show every module"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-muted transition hover:border-black/20 hover:text-ink"
          >
            {expanded ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
          </button>
        </div>
        <nav
          aria-label="All modules"
          className={cn(
            "flex flex-1 flex-col gap-1 overflow-y-auto",
            expanded ? "w-full items-stretch" : "items-center",
          )}
        >
          {RAIL.map((item, index) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const badge = item.badge ? counts[item.badge] : 0;
            const spaced = index === 2;
            return (
              <div key={item.href} className={cn(spaced && "mt-2 border-t border-black/5 pt-2")}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={pathname === item.href ? "page" : undefined}
                  title={expanded ? undefined : [item.label, ...item.children.map((c) => c.label)].join(" · ")}
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

                {expanded && item.children.length > 0 ? (
                  <div className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-9 pr-1">
                    {item.children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          title={child.hint}
                          aria-current={childActive ? "page" : undefined}
                          className={cn(
                            "flex h-8 items-center rounded-xl px-2.5 text-[11px] font-semibold transition",
                            childActive ? "bg-sage/70 text-green" : "text-muted hover:bg-subtle hover:text-ink",
                          )}
                        >
                          <span className="truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className={cn("mt-2 flex flex-col gap-1 border-t border-black/5 pt-2", expanded ? "w-full items-stretch" : "items-center")}>
          <Link
            href={SETTINGS_HREF}
            aria-label="Settings"
            title={expanded ? undefined : "Settings"}
            className={cn(
              "flex h-10 items-center gap-3 rounded-2xl transition-colors",
              expanded ? "w-full px-3" : "w-10 justify-center",
              isActive(pathname, SETTINGS_HREF) ? "bg-sage text-green" : "text-muted hover:bg-subtle hover:text-ink",
            )}
          >
            <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
            {expanded ? <span className="truncate text-[12px] font-bold tracking-tight">Settings</span> : null}
          </Link>
          <Link
            href="/help"
            aria-label="How to use this software"
            title={expanded ? undefined : "How to use this software"}
            className={cn(
              "flex h-10 items-center gap-3 rounded-2xl transition-colors",
              expanded ? "w-full px-3" : "w-10 justify-center",
              pathname === "/help" ? "bg-sage text-green" : "text-muted hover:bg-subtle hover:text-ink",
            )}
          >
            <HelpCircle className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
            {expanded ? <span className="truncate text-[12px] font-bold tracking-tight">Guide</span> : null}
          </Link>
          <div className={cn("flex", expanded ? "items-center gap-2 px-1" : "justify-center")}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[10px] font-extrabold text-gold">
              MP
            </div>
            {expanded ? <span className="truncate text-[11px] font-bold text-muted">Partner</span> : null}
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
  // Rendered only after mount: the server formats this in its own timezone
  // (UTC on Vercel) while the browser formats it in the firm's, so an SSR'd
  // date disagrees with the client for the first hours of an Indian day.
  const [today, setToday] = React.useState<string | null>(null);
  React.useEffect(() => {
    setToday(new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }));
  }, []);
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
          {today ? (
            <span className="hidden rounded-full border border-black/5 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-muted md:inline-flex">
              {today}
            </span>
          ) : null}
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
            href="/help"
            title="How to use this software"
            aria-label="How to use this software"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/70 text-muted transition hover:text-ink"
          >
            <HelpCircle className="h-4 w-4" />
          </Link>
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
  return (
    <div className="sticky top-[68px] z-20 overflow-x-auto border-b border-black/[0.04] bg-canvas/80 px-3 py-2 backdrop-blur-xl lg:hidden">
      <nav aria-label="All modules" className="flex w-max items-center gap-1.5">
        {RAIL.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <React.Fragment key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition",
                  active ? "bg-green text-white" : "bg-white/70 text-muted hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
              {item.children.map((child) => {
                const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "whitespace-nowrap rounded-full px-2.5 py-1.5 text-[10px] font-semibold transition",
                      childActive ? "bg-sage text-green" : "bg-white/40 text-muted hover:text-ink",
                    )}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </React.Fragment>
          );
        })}
      </nav>
    </div>
  );
}
