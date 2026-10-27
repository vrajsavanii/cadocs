/**
 * The service catalogue: what a CA firm actually sells, how often it repeats,
 * when it is due, and what the client must send for it.
 *
 * Everything here is pure data + date arithmetic so it can run on the server
 * and in the browser without a database or a network call. Due dates are
 * statutory *defaults* (GSTR-1 on the 11th, GSTR-3B on the 20th, ITR on 31
 * July, and so on); notices and extensions change them, which is why every
 * generated date stays editable.
 */

import type { Client, ClientService, WorkStage } from "./types";

// ── Vocabulary ────────────────────────────────────────────────────────────────

export type { WorkStage };
export type ServiceFrequency = "monthly" | "quarterly" | "half_yearly" | "annual" | "one_time";
export type ServiceLine = "gst" | "income_tax" | "audit" | "tds" | "roc" | "bookkeeping" | "payroll" | "other";
export type BillingCycle = "per_cycle" | "monthly" | "quarterly" | "annual";

export const SERVICE_LINES: Array<{ key: ServiceLine; label: string; blurb: string }> = [
  { key: "gst", label: "GST", blurb: "GSTR-1, GSTR-3B, GSTR-9 and reconciliations" },
  { key: "income_tax", label: "Income tax", blurb: "ITR, advance tax and computations" },
  { key: "audit", label: "Audit", blurb: "Statutory, tax and internal audit" },
  { key: "tds", label: "TDS", blurb: "Monthly challans and quarterly statements" },
  { key: "roc", label: "ROC", blurb: "AOC-4, MGT-7 and company secretarial work" },
  { key: "bookkeeping", label: "Bookkeeping", blurb: "Ledgers, reconciliations and MIS" },
  { key: "payroll", label: "Payroll", blurb: "Salary processing and payslips" },
  { key: "other", label: "Other", blurb: "Advisory, certifications and one-off work" },
];

export const WORK_STAGES: Array<{ key: WorkStage; label: string; short: string; role: string; blurb: string }> = [
  { key: "documents", label: "Documents", short: "Docs", role: "article", blurb: "Collect and verify the client's papers" },
  { key: "preparation", label: "Preparation", short: "Prep", role: "article", blurb: "Prepare the working, return or report" },
  { key: "review", label: "Review", short: "Review", role: "manager", blurb: "Second pair of eyes on the work" },
  { key: "filing", label: "Portal filing", short: "File", role: "manager", blurb: "File online and record the acknowledgement" },
  { key: "signoff", label: "CA sign-off", short: "Sign-off", role: "partner", blurb: "Partner's final audit and approval" },
  { key: "done", label: "Done", short: "Done", role: "partner", blurb: "Filed, billed and closed" },
];

export const STAGE_ORDER: WorkStage[] = WORK_STAGES.map((s) => s.key);

export function stageIndex(stage: WorkStage): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

export function stageInfo(stage: WorkStage) {
  return WORK_STAGES.find((s) => s.key === stage) ?? WORK_STAGES[0]!;
}

export type ChecklistItem = {
  name: string;
  category: string;
  /** Optional items are requested but never block the workflow. */
  optional?: boolean;
};

export type ServiceDef = {
  code: string;
  name: string;
  short: string;
  line: ServiceLine;
  frequency: ServiceFrequency;
  /** Human phrase for the schedule, shown in the catalogue. */
  scheduleLabel: string;
  /** Months added to the period end to reach the due month. */
  dueMonthOffset: number;
  dueDay: number;
  /** How a period is named in the UI. */
  labelStyle: "month" | "quarter" | "fy" | "ay" | "instalment";
  defaultFee: number;
  billingCycle: BillingCycle;
  checklist: ChecklistItem[];
  note?: string;
};

// ── The catalogue ─────────────────────────────────────────────────────────────

const GST_3B_CHECKLIST: ChecklistItem[] = [
  { name: "Sales register and sales invoices", category: "GST" },
  { name: "Credit / debit notes and amendments", category: "GST" },
  { name: "Purchase register and supplier bills", category: "GST" },
  { name: "GSTR-2B download and reconciliation", category: "GST" },
  { name: "Expense bills and cash book", category: "Accounting" },
  { name: "Bank statements — all current accounts", category: "Banking" },
  { name: "GST challans / PMT-06 payments", category: "GST" },
  { name: "Stock, job-work or production records", category: "Operations", optional: true },
];

const ITR_CHECKLIST: ChecklistItem[] = [
  { name: "PAN, Aadhaar and contact details", category: "Identity" },
  { name: "Form 16 / 16A from employers and deductors", category: "Income" },
  { name: "AIS / TIS and Form 26AS", category: "Income" },
  { name: "Bank statements for the full year", category: "Banking" },
  { name: "Interest and dividend certificates", category: "Income" },
  { name: "Capital gains / securities statements", category: "Investments", optional: true },
  { name: "Investment and insurance proofs (80C, 80D, NPS)", category: "Deductions", optional: true },
  { name: "Rent receipts / home-loan interest certificate", category: "Deductions", optional: true },
  { name: "Advance-tax and self-assessment challans", category: "Tax", optional: true },
  { name: "Last year's ITR and computation", category: "Prior year", optional: true },
];

const AUDIT_CHECKLIST: ChecklistItem[] = [
  { name: "Trial balance and general ledger", category: "Books" },
  { name: "Bank statements and bank confirmations", category: "Banking" },
  { name: "Sales and purchase registers", category: "Books" },
  { name: "Fixed asset register and depreciation", category: "Fixed assets" },
  { name: "Loan agreements and sanction letters", category: "Finance" },
  { name: "Stock statement and physical verification", category: "Inventory" },
  { name: "Board minutes and statutory registers", category: "Secretarial" },
  { name: "GST returns and TDS workings", category: "Statutory" },
  { name: "Related-party and group ledgers", category: "Books", optional: true },
];

export const SERVICES: ServiceDef[] = [
  {
    code: "gstr3b",
    name: "GST Filing (GSTR-3B)",
    short: "GSTR-3B",
    line: "gst",
    frequency: "monthly",
    scheduleLabel: "Monthly · 20th of the following month",
    dueMonthOffset: 1,
    dueDay: 20,
    labelStyle: "month",
    defaultFee: 2000,
    billingCycle: "monthly",
    checklist: GST_3B_CHECKLIST,
    note: "QRMP clients file quarterly (22nd/24th by state) — change the frequency on the engagement.",
  },
  {
    code: "gstr1",
    name: "GST Filing (GSTR-1)",
    short: "GSTR-1",
    line: "gst",
    frequency: "monthly",
    scheduleLabel: "Monthly · 11th of the following month",
    dueMonthOffset: 1,
    dueDay: 11,
    labelStyle: "month",
    defaultFee: 1500,
    billingCycle: "monthly",
    checklist: [
      { name: "Sales register and outward invoices", category: "GST" },
      { name: "B2B / B2C / export invoice breakup", category: "GST" },
      { name: "Credit / debit notes and cancelled invoices", category: "GST" },
      { name: "E-invoice / IRN report and e-way bills", category: "GST", optional: true },
      { name: "HSN / SAC summary", category: "GST" },
    ],
  },
  {
    code: "gstr9",
    name: "GST Annual Return (GSTR-9)",
    short: "GSTR-9",
    line: "gst",
    frequency: "annual",
    scheduleLabel: "Annual · 31 December after the financial year",
    dueMonthOffset: 9,
    dueDay: 31,
    labelStyle: "fy",
    defaultFee: 6000,
    billingCycle: "annual",
    checklist: [
      { name: "Audited financial statements", category: "Financials" },
      { name: "Annual sales and purchase registers", category: "GST" },
      { name: "GSTR-2B vs books reconciliation", category: "GST" },
      { name: "All GSTR-1 / 3B acknowledgements for the year", category: "GST" },
      { name: "ITC ledger and reversal workings", category: "GST" },
    ],
    note: "One return per GSTIN; GSTR-9C applies above the notified turnover threshold.",
  },
  {
    code: "itr",
    name: "Income Tax Return",
    short: "ITR",
    line: "income_tax",
    frequency: "annual",
    scheduleLabel: "Annual · 31 July (non-audit), 31 October (audit)",
    dueMonthOffset: 4,
    dueDay: 31,
    labelStyle: "ay",
    defaultFee: 5000,
    billingCycle: "annual",
    checklist: ITR_CHECKLIST,
    note: "Statutory default only — extensions, belated returns and the applicable AY must be confirmed each year.",
  },
  {
    code: "advance_tax",
    name: "Advance Tax",
    short: "Advance tax",
    line: "income_tax",
    frequency: "quarterly",
    scheduleLabel: "Quarterly · 15 Jun / 15 Sep / 15 Dec / 15 Mar",
    dueMonthOffset: 0,
    dueDay: 15,
    labelStyle: "instalment",
    defaultFee: 1500,
    billingCycle: "quarterly",
    checklist: [
      { name: "Provisional profit & loss and balance sheet", category: "Financials" },
      { name: "TDS / TCS summary to date", category: "Tax" },
      { name: "Investment and capital-gain details", category: "Tax", optional: true },
      { name: "Prior instalment challans", category: "Tax", optional: true },
    ],
  },
  {
    code: "tax_audit",
    name: "Tax Audit Report (3CA/3CB-3CD)",
    short: "Tax audit",
    line: "audit",
    frequency: "annual",
    scheduleLabel: "Annual · 30 September (statutory default)",
    dueMonthOffset: 6,
    dueDay: 30,
    labelStyle: "fy",
    defaultFee: 15000,
    billingCycle: "annual",
    checklist: AUDIT_CHECKLIST,
  },
  {
    code: "statutory_audit",
    name: "Statutory Audit",
    short: "Statutory audit",
    line: "audit",
    frequency: "annual",
    scheduleLabel: "Annual · report signed before the AGM",
    dueMonthOffset: 6,
    dueDay: 30,
    labelStyle: "fy",
    defaultFee: 25000,
    billingCycle: "annual",
    checklist: [
      ...AUDIT_CHECKLIST,
      { name: "Annual report and notes to accounts", category: "Financials" },
      { name: "Confirmations from banks, debtors and creditors", category: "Confirmations" },
    ],
  },
  {
    code: "tds_payment",
    name: "TDS Payment",
    short: "TDS payment",
    line: "tds",
    frequency: "monthly",
    scheduleLabel: "Monthly · 7th of the following month",
    dueMonthOffset: 1,
    dueDay: 7,
    labelStyle: "month",
    defaultFee: 500,
    billingCycle: "monthly",
    checklist: [
      { name: "TDS working and deductee list", category: "TDS" },
      { name: "Vendor invoices and PAN details", category: "TDS" },
      { name: "Salary register (for 24Q)", category: "Payroll", optional: true },
      { name: "Previous challans and adjustments", category: "TDS", optional: true },
    ],
    note: "Tax deducted in March is generally deposited by 30 April for non-government deductors.",
  },
  {
    code: "tds_return",
    name: "TDS Return (24Q/26Q)",
    short: "TDS return",
    line: "tds",
    frequency: "quarterly",
    scheduleLabel: "Quarterly · 31 Jul / 31 Oct / 31 Jan / 31 May",
    dueMonthOffset: 1,
    dueDay: 31,
    labelStyle: "quarter",
    defaultFee: 2500,
    billingCycle: "quarterly",
    checklist: [
      { name: "Salary register / vendor ledger for the quarter", category: "TDS" },
      { name: "Deductee PAN list", category: "TDS" },
      { name: "Challan details for the quarter", category: "TDS" },
      { name: "Previous return / correction statement", category: "TDS", optional: true },
    ],
  },
  {
    code: "roc_annual",
    name: "ROC Annual Filing (AOC-4 / MGT-7)",
    short: "ROC annual",
    line: "roc",
    frequency: "annual",
    scheduleLabel: "Annual · 30 days (AOC-4) / 60 days (MGT-7) from AGM",
    dueMonthOffset: 7,
    dueDay: 30,
    labelStyle: "fy",
    defaultFee: 8000,
    billingCycle: "annual",
    checklist: [
      { name: "Audited financial statements and board report", category: "Financials" },
      { name: "Shareholding and share-transfer details", category: "Secretarial" },
      { name: "Board and auditor details", category: "Secretarial" },
      { name: "AGM notice, minutes and resolutions", category: "Secretarial" },
      { name: "Director KYC and DIN details", category: "Secretarial" },
    ],
    note: "AGM-linked dates: AOC-4 within 30 days, MGT-7 within 60 days. Default here is a 30 September AGM.",
  },
  {
    code: "bookkeeping",
    name: "Bookkeeping & MIS",
    short: "Bookkeeping",
    line: "bookkeeping",
    frequency: "monthly",
    scheduleLabel: "Monthly · close by the 15th",
    dueMonthOffset: 1,
    dueDay: 15,
    labelStyle: "month",
    defaultFee: 5000,
    billingCycle: "monthly",
    checklist: [
      { name: "Bank statements — all accounts", category: "Banking" },
      { name: "Sales invoices and receivables", category: "Books" },
      { name: "Purchase bills and payables", category: "Books" },
      { name: "Expense bills and petty cash", category: "Books" },
      { name: "Loan and EMI statements", category: "Finance", optional: true },
    ],
  },
  {
    code: "payroll",
    name: "Payroll Processing",
    short: "Payroll",
    line: "payroll",
    frequency: "monthly",
    scheduleLabel: "Monthly · salary run by the 7th",
    dueMonthOffset: 1,
    dueDay: 7,
    labelStyle: "month",
    defaultFee: 3000,
    billingCycle: "monthly",
    checklist: [
      { name: "Attendance and leave records", category: "Payroll" },
      { name: "New joiners, exits and salary revisions", category: "Payroll" },
      { name: "Investment declarations (12BB)", category: "Payroll", optional: true },
      { name: "Reimbursement bills", category: "Payroll", optional: true },
    ],
  },
  {
    code: "other",
    name: "Other Engagement",
    short: "Engagement",
    line: "other",
    frequency: "one_time",
    scheduleLabel: "One-time · set the due date",
    dueMonthOffset: 0,
    dueDay: 7,
    labelStyle: "month",
    defaultFee: 0,
    billingCycle: "per_cycle",
    checklist: [{ name: "Scope-specific documents", category: "General" }],
  },
];

export function getService(code: string): ServiceDef {
  return SERVICES.find((s) => s.code === code) ?? SERVICES[SERVICES.length - 1]!;
}

export function serviceName(code: string): string {
  return getService(code).name;
}

export function validateServiceCode(code: string): boolean {
  return SERVICES.some((s) => s.code === code);
}

export function servicesForLine(line: ServiceLine): ServiceDef[] {
  return SERVICES.filter((s) => s.line === line);
}

/** Best-fit catalogue code for a free-text service label ("GST Filing, ITR"). */
export function serviceCodeFromLabel(label: string): string | null {
  const q = label.toLowerCase();
  if (/gstr[\s-]?3b/.test(q)) return "gstr3b";
  if (/gstr[\s-]?1/.test(q)) return "gstr1";
  if (/gstr[\s-]?9/.test(q)) return "gstr9";
  if (/tax audit/.test(q)) return "tax_audit";
  if (/statutory audit|trust audit/.test(q)) return "statutory_audit";
  if (/\btds\b/.test(q)) return "tds_return";
  if (/\bitr\b|income tax/.test(q)) return "itr";
  if (/roc|aoc|mgt/.test(q)) return "roc_annual";
  if (/book/.test(q)) return "bookkeeping";
  if (/payroll/.test(q)) return "payroll";
  if (/gst/.test(q)) return "gstr3b";
  return null;
}

// ── Calendar arithmetic ───────────────────────────────────────────────────────
// All dates are calendar days (no time component). India has no DST, and the
// firm runs on IST regardless of where the server is hosted.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function parseDay(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return { y: y ?? 1970, m: (m ?? 1) - 1, d: d ?? 1 };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Clamp a due day so "31st" still works in February and April. */
function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex));
}

function addMonths(year: number, monthIndex: number, months: number): { y: number; m: number } {
  const total = year * 12 + monthIndex + months;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
}

export function diffDays(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseDay(iso);
  const dt = new Date(Date.UTC(y, m, d + days));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

/** Indian financial year label for a date: 2026-04-01 → "2026-27". */
export function fyForDate(iso: string): string {
  const { y, m } = parseDay(iso);
  const start = m >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** 1 April of the FY that contains the date. */
export function fyStart(iso: string): string {
  const { y, m } = parseDay(iso);
  return ymd(m >= 3 ? y : y - 1, 3, 1);
}

/** 31 March of the FY that contains the date. */
export function fyEnd(iso: string): string {
  const start = fyStart(iso);
  const { y } = parseDay(start);
  return ymd(y + 1, 2, 31);
}

/** Assessment year label from a financial year: "2025-26" → "2026-27". */
export function assessmentYear(fy: string): string {
  const start = Number(fy.slice(0, 4));
  if (!Number.isFinite(start)) return fy;
  return `${start + 1}-${String((start + 2) % 100).padStart(2, "0")}`;
}

export type Cycle = {
  period: string;
  period_start: string;
  period_end: string;
  due_date: string;
  fy: string;
  label: string;
};

function periodLabel(service: ServiceDef, endISO: string): { period: string; fy: string } {
  const { y, m } = parseDay(endISO);
  const fy = fyForDate(endISO);
  if (service.labelStyle === "month") return { period: `${MONTHS[m]} ${y}`, fy };
  if (service.labelStyle === "quarter") {
    const q = Math.floor(m / 3) + 1;
    return { period: `Q${q} FY ${fy}`, fy };
  }
  if (service.labelStyle === "ay") return { period: `AY ${assessmentYear(fy)} · FY ${fy}`, fy };
  if (service.labelStyle === "instalment") {
    const q = Math.floor(m / 3) + 1;
    return { period: `Q${q} FY ${fy} · ${MONTHS[m]} instalment`, fy };
  }
  return { period: `FY ${fy}`, fy };
}

function cycleFromPeriodEnd(service: ServiceDef, endISO: string): Cycle {
  const { y, m } = parseDay(endISO);
  const due = addMonths(y, m, service.dueMonthOffset);
  const dueDate = ymd(due.y, due.m, clampDay(due.y, due.m, service.dueDay));
  const { period, fy } = periodLabel(service, endISO);
  return { period, period_start: fyStart(endISO), period_end: endISO, due_date: dueDate, fy, label: service.scheduleLabel };
}

/** The working period a firm is on today for this service. */
export function currentCycle(serviceInput: string | ServiceDef, today: string): Cycle {
  const service = typeof serviceInput === "string" ? getService(serviceInput) : serviceInput;
  const { y, m } = parseDay(today);

  if (service.frequency === "monthly") {
    // Previous calendar month — the month whose return is being prepared now.
    const prev = addMonths(y, m, -1);
    return cycleFromPeriodEnd(service, ymd(prev.y, prev.m, daysInMonth(prev.y, prev.m)));
  }

  if (service.frequency === "quarterly") {
    if (service.code === "advance_tax") {
      const dates: Array<{ iso: string; period: string; fy: string }> = [];
      for (let offset = -1; offset <= 1; offset++) {
        const year = y + offset;
        [5, 8, 11, 2].forEach((month) => {
          const iso = ymd(month === 2 ? year + 1 : year, month, 15);
          const labelMonth = month === 2 ? 2 : month;
          const q = month === 2 ? 4 : Math.floor(month / 3) + 1;
          const fy = fyForDate(iso);
          dates.push({ iso, period: `Q${q} FY ${fy} · ${MONTHS[labelMonth]} instalment`, fy });
        });
      }
      const chosen = dates
        .filter((d) => diffDays(d.iso, today) <= 30)
        .sort((a, b) => Math.abs(diffDays(today, a.iso)) - Math.abs(diffDays(today, b.iso)))[0] ?? dates[0]!;
      return {
        period: chosen.period,
        period_start: chosen.iso,
        period_end: chosen.iso,
        due_date: chosen.iso,
        fy: chosen.fy,
        label: service.scheduleLabel,
      };
    }
    const quarterEndMonth = m - ((m % 3) + 1); // previous completed quarter end
    const adjusted = quarterEndMonth < 0 ? 12 + quarterEndMonth : quarterEndMonth;
    const year = quarterEndMonth < 0 ? y - 1 : y;
    const end = ymd(year, adjusted, daysInMonth(year, adjusted));
    return cycleFromPeriodEnd(service, end);
  }

  if (service.frequency === "annual") {
    // Nearest statutory due date, with a 150-day grace for late seasons.
    const candidates: Cycle[] = [];
    for (let offset = -1; offset <= 2; offset++) {
      const fyEndYear = y + offset;
      const end = ymd(fyEndYear, 2, 31);
      candidates.push(cycleFromPeriodEnd(service, end));
    }
    const scored = candidates
      .map((cycle) => {
        const gap = diffDays(today, cycle.due_date);
        const late = gap < 0 ? -gap : 0;
        return { cycle, score: late > 150 ? 1_000_000 + late : Math.abs(gap) };
      })
      .sort((a, b) => a.score - b.score)[0]!;
    return scored.cycle;
  }

  // One-time work: open with a one-week runway.
  const end = addDaysISO(today, 7);
  const { period, fy } = periodLabel(service, today);
  return { period, period_start: today, period_end: end, due_date: end, fy, label: service.scheduleLabel };
}

/** The next period after a cycle, for previews and recurring generation. */
export function nextCycle(serviceInput: string | ServiceDef, cycle: Cycle): Cycle {
  const service = typeof serviceInput === "string" ? getService(serviceInput) : serviceInput;
  if (service.frequency === "monthly") {
    const { y, m } = parseDay(cycle.period_end);
    const next = addMonths(y, m, 1);
    return cycleFromPeriodEnd(service, ymd(next.y, next.m, daysInMonth(next.y, next.m)));
  }
  if (service.frequency === "quarterly") {
    const { y, m } = parseDay(cycle.period_end);
    const next = addMonths(y, m, 3);
    return cycleFromPeriodEnd(service, ymd(next.y, next.m, daysInMonth(next.y, next.m)));
  }
  if (service.frequency === "annual") {
    const { y } = parseDay(cycle.period_end);
    return cycleFromPeriodEnd(service, ymd(y + 1, 2, 31));
  }
  const due = addDaysISO(cycle.due_date, 1);
  return { ...cycle, period_start: due, period_end: due, due_date: due };
}

/** Request-by date: the client should send papers this many days before due. */
export function requestByDate(dueDate: string, frequency: ServiceFrequency): string {
  const lead = frequency === "monthly" ? 4 : frequency === "quarterly" ? 8 : frequency === "half_yearly" ? 14 : 20;
  return addDaysISO(dueDate, -lead);
}

export function frequencyLabel(frequency: ServiceFrequency): string {
  return frequency === "monthly"
    ? "Monthly"
    : frequency === "quarterly"
      ? "Quarterly"
      : frequency === "half_yearly"
        ? "Half-yearly"
        : frequency === "annual"
          ? "Annual"
          : "One-time";
}

// ── Indian identifiers ────────────────────────────────────────────────────────

export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export const PAN_ENTITY: Record<string, string> = {
  P: "Individual",
  C: "Company",
  H: "HUF",
  F: "Firm / LLP",
  A: "Association of persons",
  T: "Trust",
  B: "Body of individuals",
  L: "Local authority",
  J: "Artificial juridical person",
  G: "Government",
};

/** Normalise an Indian mobile number to 10 digits (or keep a country code). */
export function normalisePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidPhone(input: string): boolean {
  const phone = normalisePhone(input);
  return /^[6-9]\d{9}$/.test(phone);
}

export function validateEmail(input: string): string | null {
  if (!input) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input) ? null : "Enter a valid email address";
}

export function validatePan(input: string): string | null {
  const pan = (input || "").toUpperCase();
  if (!pan) return "PAN is required";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return "PAN must be 10 characters, e.g. AABCS1234A";
  if (!PAN_ENTITY[pan[3]!]) return "The 4th PAN character must be a recognised holder type";
  return null;
}

function gstinChecksum(first14: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < first14.length; i++) {
    const value = chars.indexOf(first14[i]!);
    if (value < 0) return "";
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return chars[(36 - (sum % 36)) % 36] ?? "";
}

export type GstinInfo = {
  valid: boolean;
  stateCode: string;
  state: string;
  pan: string;
  entityCode: string;
  error?: string;
};

export function inspectGstin(input: string): GstinInfo {
  const gstin = (input || "").toUpperCase().trim();
  const empty: GstinInfo = { valid: false, stateCode: "", state: "", pan: "", entityCode: "" };
  if (!gstin) return { ...empty, error: "GSTIN is required" };
  if (gstin.length !== 15) return { ...empty, error: "GSTIN must be 15 characters" };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin)) {
    return { ...empty, error: "GSTIN format is invalid" };
  }
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATES[stateCode]) return { ...empty, error: `Unknown GST state code ${stateCode}` };
  if (gstin[13] !== "Z") return { ...empty, error: "The 14th character of a GSTIN must be Z" };
  const expected = gstinChecksum(gstin.slice(0, 14));
  if (expected && gstin[14] !== expected) {
    return { ...empty, error: `GSTIN checksum failed — expected ${expected} as the last character` };
  }
  return {
    valid: true,
    stateCode,
    state: GST_STATES[stateCode] ?? "",
    pan: gstin.slice(2, 12),
    entityCode: gstin[12] ?? "",
  };
}

export function validateGstin(input: string): string | null {
  if (!input) return null; // unregistered clients are legitimate
  return inspectGstin(input).error ?? null;
}

export function validateTan(input: string): string | null {
  if (!input) return null;
  return /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(input.toUpperCase()) ? null : "TAN must be 10 characters, e.g. MUMS12345A";
}

export function validateCin(input: string): string | null {
  if (!input) return null;
  return /^[LUu]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(input.toUpperCase())
    ? null
    : "CIN must be 21 characters, e.g. U17120MH2005PTC123456";
}

/** Warn when the PAN holder type does not look like the chosen constitution. */
export function panEntityWarning(pan: string, entityType: string): string | null {
  if (!pan || !entityType) return null;
  const holder = PAN_ENTITY[pan.toUpperCase()[3] ?? ""];
  if (!holder) return null;
  const map: Record<string, string[]> = {
    Individual: ["Individual"],
    "Private Limited": ["Company"],
    "Public Limited": ["Company"],
    LLP: ["Firm / LLP"],
    Partnership: ["Firm / LLP"],
    Proprietorship: ["Individual"],
    HUF: ["HUF"],
    Trust: ["Trust"],
    Society: ["Association of persons", "Trust"],
  };
  const expected = map[entityType];
  if (!expected) return null;
  return expected.includes(holder) ? null : `PAN belongs to a ${holder.toLowerCase()}, but the client is a ${entityType.toLowerCase()}. Check the constitution.`;
}

// ── Onboarding completeness ───────────────────────────────────────────────────

export type OnboardingItem = {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  required: boolean;
};

export function onboardingChecklist(client: Client, services: ClientService[]): OnboardingItem[] {
  const filled = (v: string | undefined | null) => Boolean(v && String(v).trim());
  return [
    { key: "pan", label: "PAN verified", detail: "The client's permanent account number is on file", done: Boolean(client.pan), required: true },
    {
      key: "gstin",
      label: "GSTIN or unregistered",
      detail: client.gst_number ? "GSTIN captured and checksum-valid" : "Marked unregistered — no GSTIN needed",
      done: Boolean(client.gst_number) || client.gst_registration_type === "Unregistered",
      required: true,
    },
    { key: "contact", label: "WhatsApp contact", detail: "A mobile number for document requests", done: isValidPhone(client.phone), required: true },
    { key: "consent", label: "WhatsApp consent", detail: "The client agreed to receive WhatsApp updates", done: Boolean(client.whatsapp_opt_in), required: true },
    { key: "address", label: "Registered address", detail: "Address and pincode for filings and invoices", done: filled(client.address) && filled(client.pincode), required: true },
    { key: "services", label: "Service enrolled", detail: "At least one recurring service with a fee", done: services.length > 0, required: true },
    {
      key: "owners",
      label: "Work owners assigned",
      detail: "A preparer and reviewer on every engagement",
      done: services.length > 0 && services.every((s) => filled(s.owner) && filled(s.reviewer)),
      required: true,
    },
    { key: "kyc", label: "KYC document received", detail: "PAN card / constitution proof uploaded", done: false, required: false },
  ];
}

export function onboardingProgress(items: OnboardingItem[]): number {
  const required = items.filter((i) => i.required);
  if (required.length === 0) return 100;
  return Math.round((required.filter((i) => i.done).length / required.length) * 100);
}
