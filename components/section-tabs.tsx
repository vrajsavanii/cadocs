"use client";

/**
 * The tab strip inside a grouped section.
 *
 * The sidebar says "Compliance"; this strip says *which part* of compliance
 * you are in and what the other parts are for. It is the piece that makes
 * eleven modules feel like four, so it renders on every page of a section —
 * including the first — and each tab carries a plain-language hint.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";
import { sectionFor, tabsFor } from "@/lib/nav";

export function SectionTabs() {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const tabs = tabsFor(pathname);
  if (!section || tabs.length === 0) return null;

  const active = tabs.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`)) ?? tabs[0]!;

  return (
    <div className="mb-4 rounded-3xl border border-black/5 bg-white/70 p-3 shadow-[0_10px_30px_-24px_rgba(25,32,28,0.35)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 pb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{section.label}</p>
        <span className="hidden text-[11px] text-muted sm:inline">· {section.blurb}</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const isActive = tab.href === active.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              title={tab.hint}
              className={cn(
                "flex shrink-0 flex-col rounded-2xl px-3.5 py-2 transition",
                isActive ? "bg-green text-white shadow-[0_8px_20px_-12px_rgba(59,82,68,0.8)]" : "text-muted hover:bg-subtle hover:text-ink",
              )}
            >
              <span className="text-[12px] font-bold tracking-tight">{tab.label}</span>
              <span className={cn("hidden text-[10px] leading-tight lg:block", isActive ? "text-white/70" : "text-muted")}>
                {tab.hint}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
