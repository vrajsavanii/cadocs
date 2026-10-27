/**
 * The one source of truth for how the practice is organised.
 *
 * Sixteen modules is how the software is built; it is not how a CA firm works.
 * This file collapses the modules into the six moves a firm actually makes in
 * a day — clear the calendar, unblock paperwork, collect the fees, keep the
 * client desk honest, let automation run, and win the next engagement — plus
 * Settings. Every route still exists, still deep-links, and is listed under its
 * move when the rail is expanded, so nothing is unreachable and nothing is a
 * mystery.
 *
 * Order is deliberate: it is the order of the working day, top to bottom.
 * Pure data — safe to import from both server and client components.
 */

export type NavKey =
  | "today"
  | "workflow"
  | "compliance"
  | "documents"
  | "clients"
  | "fees"
  | "automation";

export type SectionTab = {
  label: string;
  href: string;
  /** When to use this tab, in the firm's language rather than the database's. */
  hint: string;
};

export type NavSection = {
  key: NavKey;
  /** Sidebar label — the job to be done, not the module name. */
  label: string;
  href: string;
  routes: string[];
  blurb: string;
  tabs: SectionTab[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "today",
    label: "My day",
    href: "/",
    routes: ["/"],
    blurb: "What needs doing right now, in the order to do it",
    tabs: [],
  },
  {
    key: "workflow",
    label: "Engagements",
    href: "/workflow",
    routes: ["/workflow"],
    blurb: "Every service's period moving from documents to partner sign-off",
    tabs: [],
  },
  {
    key: "compliance",
    label: "Compliance",
    href: "/compliance",
    routes: ["/compliance", "/notices", "/dsc", "/udin"],
    blurb: "Every statutory deadline — and the registers that go with it",
    tabs: [
      { label: "Filing calendar", href: "/compliance", hint: "GST, TDS, ITR and ROC work with owners and due dates" },
      { label: "Notices", href: "/notices", hint: "Demands and scrutiny with reply deadlines" },
      { label: "DSC", href: "/dsc", hint: "Token validity so filings don't get rejected" },
      { label: "UDIN", href: "/udin", hint: "The ICAI number issued for each filing" },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    routes: ["/documents", "/folders"],
    blurb: "Ask for papers, see what's missing, stop chasing the moment it lands",
    tabs: [
      { label: "Request tracker", href: "/documents", hint: "Every request, its reminder count and what is still pending" },
      { label: "Client folders", href: "/folders", hint: "Client → financial year → category, with files in place" },
    ],
  },
  {
    key: "clients",
    label: "Clients",
    href: "/clients",
    routes: ["/clients"],
    blurb: "One desk per client: what they owe, what's open, what was last said",
    tabs: [],
  },
  {
    key: "fees",
    label: "Fees",
    href: "/invoices",
    routes: ["/invoices", "/timesheets", "/reports"],
    blurb: "Bill it, recover it, and see whether the effort paid",
    tabs: [
      { label: "Invoices", href: "/invoices", hint: "GST bills, part payments and ageing" },
      { label: "Timesheets", href: "/timesheets", hint: "Effort logged by the team, approved by you" },
      { label: "Reports", href: "/reports", hint: "Ageing, realisation, utilisation and profitability" },
    ],
  },
];

/**
 * The Copilot is a tool, not a stage of the day — so it sits under "My day" on
 * the rail rather than hiding behind a keyboard shortcut.
 */
export const COPILOT_HREF = "/agent";

/** Settings is deliberately outside the workflow — you visit it, you don't work in it. */
export const SETTINGS_HREF = "/settings";

/** Which section a pathname belongs to (longest match wins). */
export function sectionFor(pathname: string): NavSection | undefined {
  const matches = NAV_SECTIONS.filter((section) =>
    section.routes.some((route) => (route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`))),
  );
  if (matches.length === 0) return undefined;
  return matches.sort((a, b) => Math.max(...b.routes.map((r) => r.length)) - Math.max(...a.routes.map((r) => r.length)))[0];
}

/** The tab strip for a page, or none when the section is a single screen. */
export function tabsFor(pathname: string): SectionTab[] {
  return sectionFor(pathname)?.tabs ?? [];
}
