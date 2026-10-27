/**
 * Period arithmetic for recurring engagements.
 *
 * The engine never works from a calendar year alone: Indian compliance periods
 * are financial-year based (1 April – 31 March), GST/TDS quarters are the same
 * quarters as the FY, and income-tax work carries an assessment year as well as
 * a financial year. These functions are pure so they can be unit tested without
 * a database and reused by previews, jobs and the UI.
 */
import type { PeriodType, ServiceFrequency } from "./types";
import {
  addDaysISO,
  assessmentYear,
  diffDays,
  fyEnd,
  fyForDate,
  fyStart,
} from "./services";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const FREQUENCIES: ServiceFrequency[] = ["monthly", "quarterly", "half_yearly", "annual", "one_time"];

export function parseFrequency(value: string | undefined | null): ServiceFrequency {
  const raw = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "half_yearly" || raw === "halfyearly" || raw === "half_yearly") return "half_yearly";
  if (raw === "monthly") return "monthly";
  if (raw === "quarterly") return "quarterly";
  if (raw === "annual" || raw === "yearly") return "annual";
  return "one_time";
}

export function periodTypeFor(frequency: ServiceFrequency): PeriodType {
  return frequency === "half_yearly" ? "half_yearly" : frequency;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y: y ?? 1970, m: (m ?? 1) - 1, d: d ?? 1 };
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function monthEnd(year: number, monthIndex: number): string {
  return ymd(year, monthIndex, daysInMonth(year, monthIndex));
}

export function monthStart(year: number, monthIndex: number): string {
  return ymd(year, monthIndex, 1);
}

export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parse(iso);
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function previousDay(iso: string): string {
  return addDaysISO(iso, -1);
}

function isAdvanceTax(serviceCode: string): boolean {
  return serviceCode === "advance_tax";
}

/** Quarter ends in the Indian financial year: Jun, Sep, Dec, Mar. */
const QUARTER_END_MONTHS = [2, 5, 8, 11];

function completedQuarterEnd(today: string): string {
  const { y, m } = parse(today);
  // A quarter ending this month is only complete once the month is over.
  const candidates: string[] = [];
  for (const month of QUARTER_END_MONTHS) {
    if (month < m) candidates.push(monthEnd(y, month));
    if (month > m) candidates.push(monthEnd(y - 1, month));
    if (month === m) candidates.push(monthEnd(y - 1, month));
  }
  return candidates.sort().at(-1)!;
}

function completedHalfEnd(today: string): string {
  const { y, m } = parse(today);
  const candidates: string[] = [];
  for (const month of [2, 8]) {
    if (month < m) candidates.push(monthEnd(y, month));
    if (month > m) candidates.push(monthEnd(y - 1, month));
    if (month === m) candidates.push(monthEnd(y - 1, month));
  }
  return candidates.sort().at(-1)!;
}

/** The period currently in progress; activation uses it when it starts mid-period. */
export function currentPeriodEnd(
  frequency: ServiceFrequency,
  today: string,
  serviceCode = "",
): string {
  const { y, m } = parse(today);
  if (frequency === "monthly") return monthEnd(y, m);
  if (frequency === "quarterly") {
    for (const month of QUARTER_END_MONTHS) {
      if (month >= m) return monthEnd(y, month);
    }
    return monthEnd(y + 1, 2);
  }
  if (frequency === "half_yearly") return m <= 8 ? monthEnd(y, 8) : monthEnd(y + 1, 2);
  if (frequency === "annual") return ymd(y + 1, 2, 31);
  void serviceCode;
  return today;
}

/** The last period that has actually finished, used for unattended generation. */
export function latestCompletedPeriodEnd(
  frequency: ServiceFrequency,
  today: string,
  serviceCode = "",
): string {
  const { y, m, d } = parse(today);
  if (frequency === "monthly") {
    const prev = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    return monthEnd(prev.y, prev.m);
  }
  if (frequency === "quarterly") {
    if (isAdvanceTax(serviceCode)) {
      // Advance-tax instalments are due on the 15th of Jun/Sep/Dec/Mar; the
      // instalment date itself is the period boundary.
      const candidates: string[] = [];
      for (const month of [2, 5, 8, 11]) {
        const thisYear = ymd(y, month, 15);
        if (thisYear <= today) candidates.push(thisYear);
        const lastYear = ymd(y - 1, month, 15);
        if (lastYear <= today) candidates.push(lastYear);
      }
      return candidates.sort().at(-1)!;
    }
    return completedQuarterEnd(today);
  }
  if (frequency === "half_yearly") return completedHalfEnd(today);
  if (frequency === "annual") {
    // The last 31 March that has fully passed.
    return m > 2 || (m === 2 && d >= 31) ? ymd(y, 2, 31) : ymd(y - 1, 2, 31);
  }
  return today;
}

export type EngagementPeriod = {
  period: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  fy: string;
  assessment_year: string | null;
};

function monthLabel(iso: string): string {
  const { y, m } = parse(iso);
  return `${MONTHS[m]} ${y}`;
}

function quarterNumber(iso: string): number {
  const { m } = parse(iso);
  if (m >= 3 && m <= 5) return 1;
  if (m >= 6 && m <= 8) return 2;
  if (m >= 9 && m <= 11) return 3;
  return 4;
}

function halfLabel(iso: string): "H1" | "H2" {
  const { m } = parse(iso);
  return m >= 3 && m <= 8 ? "H1" : "H2";
}

/**
 * Builds the human label and boundaries for a period ending on `endISO`.
 * `serviceCode` is used only for the income-tax assessment-year convention and
 * the advance-tax instalment naming; everything else follows frequency.
 */
export function periodForEnd(
  frequency: ServiceFrequency,
  endISO: string,
  serviceCode = "",
): EngagementPeriod {
  const fy = fyForDate(endISO);
  const { m } = parse(endISO);
  if (frequency === "monthly") {
    return {
      period: monthLabel(endISO),
      period_type: "monthly",
      period_start: monthStart(parse(endISO).y, m),
      period_end: monthEnd(parse(endISO).y, m),
      fy,
      assessment_year: null,
    };
  }
  if (frequency === "quarterly") {
    if (isAdvanceTax(serviceCode)) {
      const q = quarterNumber(endISO);
      return {
        period: `Q${q} FY ${fy} · ${MONTHS[m]} instalment`,
        period_type: "quarterly",
        period_start: endISO,
        period_end: endISO,
        fy,
        assessment_year: null,
      };
    }
    return {
      period: `Q${quarterNumber(endISO)} FY ${fy}`,
      period_type: "quarterly",
      period_start: addMonths(monthStart(parse(endISO).y, m), -2),
      period_end: endISO,
      fy,
      assessment_year: null,
    };
  }
  if (frequency === "half_yearly") {
    return {
      period: `${halfLabel(endISO)} FY ${fy}`,
      period_type: "half_yearly",
      period_start: halfLabel(endISO) === "H1" ? `${fy.slice(0, 4)}-04-01` : `${Number(fy.slice(0, 4)) + 1}-10-01`,
      period_end: endISO,
      fy,
      assessment_year: null,
    };
  }
  if (frequency === "annual") {
    const fyStartDate = fyStart(endISO);
    const ay = serviceCode === "itr" || serviceCode === "advance_tax" ? assessmentYear(fy) : null;
    return {
      period: ay ? `AY ${ay} · FY ${fy}` : `FY ${fy}`,
      period_type: "annual",
      period_start: fyStartDate,
      period_end: fyEnd(endISO),
      fy,
      assessment_year: ay,
    };
  }
  return {
    period: `One-time · ${monthLabel(endISO)}`,
    period_type: "one_time",
    period_start: endISO,
    period_end: endISO,
    fy,
    assessment_year: null,
  };
}

/** The period end immediately before `endISO` for this frequency. */
export function previousPeriodEnd(
  frequency: ServiceFrequency,
  endISO: string,
  serviceCode = "",
): string {
  const { y, m } = parse(endISO);
  if (frequency === "monthly") {
    return m === 0 ? monthEnd(y - 1, 11) : monthEnd(y, m - 1);
  }
  if (frequency === "quarterly") {
    if (isAdvanceTax(serviceCode)) {
      const instalments = [2, 5, 8, 11];
      const index = instalments.indexOf(m);
      if (index > 0) return ymd(y, instalments[index - 1]!, 15);
      return ymd(y - 1, 11, 15);
    }
    const previousQuarterStart = addMonths(monthStart(y, m), -3);
    return monthEnd(parse(previousQuarterStart).y, parse(previousQuarterStart).m);
  }
  if (frequency === "half_yearly") {
    return m === 8 ? monthEnd(y, 2) : monthEnd(y - 1, 8);
  }
  if (frequency === "annual") return ymd(y - 1, 2, 31);
  return addDaysISO(endISO, -1);
}

/**
 * Every completed period whose end falls inside [fromISO, toISO], oldest first.
 * Bounded so a malformed range cannot spin forever.
 */
export function enumeratePeriods(
  frequency: ServiceFrequency,
  fromISO: string,
  toISO: string,
  serviceCode = "",
): EngagementPeriod[] {
  if (!fromISO || !toISO || fromISO > toISO) return [];
  const end = latestCompletedPeriodEndScoped(frequency, toISO, serviceCode);
  const periods: EngagementPeriod[] = [];
  let cursor = end;
  for (let guard = 0; guard < 240; guard++) {
    if (!cursor || cursor < fromISO) break;
    if (cursor <= toISO) {
      const period = periodForEnd(frequency, cursor, serviceCode);
      if (!periods.some((p) => p.period === period.period)) periods.push(period);
    }
    const previous = previousPeriodEnd(frequency, cursor, serviceCode);
    if (!previous || previous >= cursor) break;
    cursor = previous;
  }
  return periods.reverse();
}

/** Same as latestCompletedPeriodEnd, but guarantees the result is <= `toISO`. */
function latestCompletedPeriodEndScoped(
  frequency: ServiceFrequency,
  toISO: string,
  serviceCode = "",
): string {
  if (frequency === "one_time") return toISO;
  // Treat the inclusive upper bound as a completed day: asking for periods up
  // to 30 September must include the period ending on 30 September.
  let cursor = latestCompletedPeriodEnd(frequency, addDaysISO(toISO, 1), serviceCode);
  return cursor > toISO ? previousPeriodEnd(frequency, cursor, serviceCode) : cursor;
}

export type ServiceWindow = {
  start_date?: string;
  end_date?: string;
};

/** Effective-date policy: no period wholly before activation, none after closure. */
export function periodWithinService(
  period: Pick<EngagementPeriod, "period_end">,
  service: ServiceWindow,
): { ok: boolean; reason: string } {
  const start = (service.start_date ?? "").slice(0, 10);
  const end = (service.end_date ?? "").slice(0, 10);
  if (start && period.period_end < start) {
    return { ok: false, reason: `Period ended ${period.period_end}, before the service started on ${start}` };
  }
  if (end && period.period_end > end) {
    return { ok: false, reason: `Period ended after the service closed on ${end}` };
  }
  return { ok: true, reason: "" };
}

/** Default window for the manual generator: the current completed period only. */
export function currentWindow(frequency: ServiceFrequency, today: string, serviceCode = ""): { from: string; to: string } {
  const end = latestCompletedPeriodEnd(frequency, today, serviceCode);
  return { from: end, to: end };
}

export function daysBetween(fromISO: string, toISO: string): number {
  return diffDays(fromISO, toISO);
}

/** Explicit alias so callers do not have to reach into the service catalogue. */
export const assessmentYearForPeriod = assessmentYear;

export function formatPeriodRange(period: EngagementPeriod): string {
  return `${period.period_start} → ${period.period_end}`;
}
