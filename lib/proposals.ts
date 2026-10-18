import { prettyDate } from "./format";

export type ProposalDocument = {
  reference: string;
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  memberNo: string;
  prospectName: string;
  companyName: string;
  entityType: string;
  services: string;
  fee: string;
  turnover?: string;
  date?: string;
  validDays?: number;
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function serviceList(services: string): string[] {
  return services
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the engagement proposal text. Pure + deterministic so the same lead
 * inputs always produce the same document, with or without an AI provider.
 */
export function buildProposal(input: ProposalDocument): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const validUntil = addDays(date, input.validDays ?? 21);
  const services = serviceList(input.services);
  const entity = input.entityType || "business";
  const turnover = input.turnover?.trim();

  const scope = services.length
    ? services.map((s) => `  • ${s}`).join("\n")
    : "  • Statutory compliance as agreed with the engagement partner";

  return [
    "PROPOSAL FOR PROFESSIONAL SERVICES",
    `${input.firmName} · Chartered Accountants`,
    `${input.firmAddress}`,
    `${input.firmPhone} · ${input.firmEmail} · M. No. ${input.memberNo}`,
    "",
    "PREPARED FOR",
    `${input.prospectName} — ${input.companyName}`,
    `Entity type: ${entity}${turnover ? ` · Turnover: ${turnover}` : ""}`,
    `Reference: ${input.reference}`,
    `Date: ${prettyDate(date)}`,
    `Valid until: ${prettyDate(validUntil)}`,
    "",
    "1. SCOPE OF ENGAGEMENT",
    `We are pleased to submit this proposal to act as the chartered accountants for ${input.companyName}. The proposed scope covers:`,
    scope,
    "",
    "2. OUR UNDERSTANDING",
    `You require a dependable compliance partner who keeps ${input.companyName} ahead of statutory deadlines, maintains clean books and responds quickly to departmental notices. As a ${entity}, your filing calendar spans periodic GST returns, direct-tax obligations, and entity-specific annual requirements.`,
    "",
    "3. ENGAGEMENT APPROACH",
    "  • A named engagement manager and a single point of contact for your team.",
    "  • A shared compliance calendar with reminders before every due date.",
    "  • Document collection through a structured checklist, with status visible to both teams.",
    "  • Review by a partner before every statutory filing or certificate.",
    "",
    "4. PROFESSIONAL FEES",
    `Proposed professional fee: ${input.fee}`,
    "Fees are exclusive of GST at the applicable rate and of statutory filing fees, late fees or penalties. Out-of-scope advisory work is quoted and approved in writing before it is taken up.",
    "",
    "5. WHY OUR FIRM",
    "  • Partner-led review on every engagement, not just onboarding.",
    "  • Deadline-first operations: compliance, documents and fee follow-ups in one place.",
    "  • Transparent fee recovery with a shared ledger of invoices and receipts.",
    "",
    "6. COMMERCIAL TERMS",
    "  • This proposal is valid until the date stated above.",
    "  • Engagement begins on written acceptance and receipt of the onboarding checklist.",
    "  • Either party may terminate with 30 days' written notice; work completed till then is billed pro rata.",
    "  • Confidentiality is maintained for all records shared with the firm.",
    "",
    "7. ACCEPTANCE",
    "To accept, reply to this proposal with the signed acceptance copy or confirm by email. We will then share the onboarding checklist and the compliance calendar for the current financial year.",
    "",
    `For ${input.firmName},`,
    "",
    "Managing Partner",
    "Chartered Accountants",
  ].join("\n");
}
