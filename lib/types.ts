export type Client = {
  client_id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  entity_type: string;
  gst_number: string;
  pan: string;
  services_opted: string;
  city: string;
  state: string;
  created_at: string;
  // ── Onboarding profile (added with the engagement workflow) ──────────────
  legal_name?: string;
  trade_name?: string;
  tan?: string;
  cin?: string;
  gst_registration_type?: string;
  gst_state_code?: string;
  date_of_incorporation?: string;
  address?: string;
  pincode?: string;
  whatsapp_opt_in?: boolean;
  onboarding_status?: "In progress" | "Active";
  relationship_status?: "Primary" | "Adhoc" | "Pending" | "Exited";
  client_status?: "Active" | "Paused" | "Exited";
  relationship_manager?: string;
  notes?: string;
  fy_end_month?: number;
  // ── Structured onboarding profile ────────────────────────────────────────
  date_of_birth?: string;
  primary_contact_designation?: string;
  whatsapp_number?: string;
  billing_contact?: string;
  authorised_representative?: string;
  preferred_language?: string;
  preferred_channel?: "WhatsApp" | "Email" | "Phone";
  contact_verified_at?: string | null;
  contact_verification_note?: string;
  whatsapp_consent_at?: string | null;
  whatsapp_consent_source?: string;
  engagement_letter_status?: string;
  engagement_letter_date?: string;
  onboarding_stage?: string;
  onboarding_completed_at?: string | null;
  created_by?: string;
  updated_by?: string;
  updated_at?: string;
};

/**
 * Kept for the read-only helpers that still tolerate legacy rows. New
 * databases have no leads table — the practice tracks relationships with
 * clients directly (see Client.relationship_status).
 */
export type Lead = {
  lead_id: string;
  name: string;
  company_name: string;
  phone: string;
  email: string;
  source: string;
  service_interest: string;
  lead_score: number;
  category: "Hot" | "Warm" | "Cold";
  status: "New" | "Contacted" | "Qualified" | "Proposal Sent" | "Won" | "Lost";
  notes: string;
  created_at: string;
};

export type WorkStage = "documents" | "preparation" | "review" | "filing" | "signoff" | "done";
export type ServiceFrequency = "monthly" | "quarterly" | "half_yearly" | "annual" | "one_time";
export type PeriodType = "monthly" | "quarterly" | "half_yearly" | "annual" | "one_time" | "custom";
export type ServiceLine = "gst" | "income_tax" | "audit" | "tds" | "roc" | "bookkeeping" | "payroll" | "other";
export type BillingCycle = "per_cycle" | "monthly" | "quarterly" | "annual";

export type Compliance = {
  compliance_id: string;
  client_id: string;
  client_name: string;
  compliance_type: string;
  period: string;
  /** The operative internal deadline used by the practice. Never claim this is statutory. */
  due_date: string;
  status: "Pending" | "In Progress" | "Filed" | "Overdue";
  filed_date: string | null;
  ack_number: string | null;
  assigned_to: string;
  notes: string;
  service_id?: string;
  service_code?: string;
  fy?: string;
  stage?: WorkStage;
  stage_updated_at?: string | null;
  preparer?: string;
  reviewer?: string;
  blocked_reason?: string;
  completed_at?: string | null;
  billed?: boolean;
  registration_id?: string;
  // ── Period model (Prompt 05) ─────────────────────────────────────────────
  period_type?: PeriodType;
  period_start?: string | null;
  period_end?: string | null;
  /** Assessment year, e.g. 2026-27. Only meaningful for income-tax work. */
  assessment_year?: string | null;
  /** Firm's own working deadline; `due_date` mirrors this for compatibility. */
  internal_target_date?: string | null;
  /** Set only when a verified due-date rule (or an audited override) exists. */
  statutory_due_date?: string | null;
  due_rule_id?: string | null;
  due_rule_version?: number | null;
  due_date_source?: string;
  due_date_verified?: boolean;
  statutory_rule_status?: "verified" | "unverified" | "conflicting" | "missing" | "manual_override";
  generation_source?: "automatic" | "manual" | "migration" | "activation";
  generated_at?: string | null;
  // ── Filing evidence, kept distinct from internal task completion ──────────
  filing_recorded_at?: string | null;
  filing_reference?: string | null;
  filing_recorded_by?: string;
  filing_confirmed_by_integration?: boolean;
  filing_notes?: string;
  // ── Configuration warnings ───────────────────────────────────────────────
  assignment_state?: "assigned" | "missing_preparer" | "missing_reviewer" | "missing_both";
  config_warnings?: string[];
};

export type DocumentItem = {
  doc_id: string;
  client_id: string;
  client_name: string;
  document_name: string;
  status: "Pending" | "Received" | "Verified" | "Rejected" | "Waived";
  requested_date: string;
  received_date: string | null;
  notes: string;
  file_name: string | null;
  file_size: number | null;
  file_path: string | null;
  uploaded_at: string | null;
  request_id?: string;
  compliance_id?: string;
  service_code?: string;
  category?: string;
  fy?: string;
  period?: string;
  reminder_count?: number;
  last_reminded_at?: string | null;
  next_reminder_on?: string | null;
  verified_by?: string;
  source?: "checklist" | "manual";
  sort_order?: number;
  registration_id?: string;
  template_version?: number;
  review_reason?: string;
  reviewed_at?: string | null;
  archived_at?: string | null;
  needs_classification?: boolean;
};

export type Invoice = {
  invoice_id: string;
  client_id: string;
  client_name: string;
  invoice_date: string;
  due_date: string;
  service_description: string;
  amount: number;
  gst_amount: number;
  total_amount: number;
  paid_amount: number;
  status: "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
  paid_date: string | null;
  service_id?: string;
  compliance_id?: string;
  period?: string;
  auto_generated?: boolean;
  reminder_count?: number;
  last_reminded_at?: string | null;
  /** Invoice notes (draft text frozen into the issue snapshot). */
  notes?: string;
  // ── Billing v2 (Prompt 10) ───────────────────────────────────────────────
  /** Human invoice number; unique per firm. Assigned only at finalisation. */
  invoice_number?: string | null;
  /** Financial-year label (Apr–Mar) this invoice belongs to. */
  fy?: string;
  /** Lifecycle: draft → pending_approval → approved → issued → cancelled. */
  lifecycle?: "" | "draft" | "pending_approval" | "approved" | "issued" | "cancelled";
  /** Stable idempotency key for automatic billing events. */
  billing_event_key?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  issued_by?: string | null;
  issued_at?: string | null;
  /** Canonical amounts in integer paise — all persisted arithmetic is integral. */
  taxable_paise?: number;
  gst_paise?: number;
  total_paise?: number;
  paid_paise?: number;
  /** Sum of issued credit notes against this invoice, in paise. */
  credit_paise?: number;
  /** Frozen copy of the lines, totals, tax and contact details at issue time. */
  issue_snapshot?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  pdf_object_key?: string | null;
  pdf_checksum?: string | null;
  pdf_size?: number | null;
  pdf_version?: number;
  pdf_generated_at?: string | null;
};

export type InvoiceLine = {
  line_id: string;
  invoice_id: string;
  seq: number;
  description: string;
  service_code?: string;
  client_service_id?: string;
  compliance_id?: string;
  registration_id?: string;
  quantity: number;
  unit_price_paise: number;
  discount_paise: number;
  taxable_paise: number;
  treatment_id: string;
  tax_kind: "none" | "gst" | "legacy";
  gst_rate_bp?: number | null;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
  created_at: string;
};

export type InvoiceEvent = {
  event_id: string;
  invoice_id: string;
  event: string;
  actor: string;
  role: string;
  detail: string;
  created_at: string;
};

export type CreditNote = {
  credit_note_id: string;
  invoice_id: string;
  number: string;
  fy: string;
  reason: string;
  taxable_paise: number;
  gst_paise: number;
  total_paise: number;
  status: "Issued" | "Voided";
  created_by: string;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
};

export type TaxTreatment = {
  treatment_id: string;
  name: string;
  kind: "none" | "gst";
  /** GST rate in basis points (18% → 1800). Null until the firm configures it. */
  rate_bp: number | null;
  active: boolean;
  note: string;
  updated_by: string;
  updated_at: string;
};

export type FirmBillingSettings = {
  billing_enabled: boolean;
  legal_name: string;
  display_name: string;
  address: string;
  contact: string;
  pan: string;
  gstin: string;
  invoice_prefix: string;
  credit_note_prefix: string;
  numbering_policy: "per_fy" | "continuous";
  currency: string;
  default_payment_terms_days: number;
  internal_billing_contact: string;
  invoice_footer: string;
  payment_instructions: string;
  bank_details: string;
  invoice_grouping: "one_per_event" | "per_service";
  approval_required_for_auto: boolean;
  approval_required_for_manual: boolean;
  deliver_on_issue: boolean;
  aging_buckets: number[];
  updated_by: string;
  updated_at: string;
};

export type Payment = {
  payment_id: string;
  invoice_id: string;
  client_name: string;
  amount: number;
  paid_on: string;
  mode: "UPI" | "Bank Transfer" | "Cash" | "Cheque" | "Card" | "Other";
  reference: string;
  notes: string;
  created_at: string;
  /** Confirmed | Pending reconciliation | Reversed. */
  status?: "Confirmed" | "Pending reconciliation" | "Reversed";
  recorded_by?: string | null;
  /** Payment id this entry reverses, when the row is an audited correction. */
  reversal_of?: string | null;
};

export type AgingBucket = {
  label: string;
  invoiceCount: number;
  outstandingPaise: number;
};

export type ReceivablesReport = {
  generatedAt: string;
  currency: string;
  totals: {
    invoicedPaise: number;
    collectedPaise: number;
    creditedPaise: number;
    outstandingPaise: number;
    overduePaise: number;
    draftCount: number;
    pendingApprovalCount: number;
    issuedCount: number;
    partiallyPaidCount: number;
    paidCount: number;
    cancelledCount: number;
  };
  aging: AgingBucket[];
  invoices: Array<{
    invoice_id: string;
    invoice_number: string | null;
    client_id: string;
    client_name: string;
    lifecycle: string;
    status: string;
    invoice_date: string;
    due_date: string;
    total_paise: number;
    paid_paise: number;
    credit_paise: number;
    balance_paise: number;
    daysOverdue: number;
    bucket: string;
  }>;
};

export type Message = {
  message_id: string;
  channel: "WhatsApp" | "Email";
  recipient_name: string;
  to_address: string;
  subject: string;
  body: string;
  related_type: string;
  related_id: string;
  status: string;
  created_at: string;
  kind?: "document_request" | "document_reminder" | "invoice" | "annual_reminder" | "welcome" | "manual";
  reminder_number?: number;
  sent_at?: string | null;
  error?: string;
  automation_key?: string;
};

export type Udin = {
  udin_id: string;
  udin: string;
  client_name: string;
  document_type: string;
  financial_year: string;
  generated_date: string;
  ca_member_no: string;
  notes: string;
};

export type Dsc = {
  dsc_id: string;
  client_name: string;
  holder_name: string;
  class_type: string;
  valid_from: string;
  valid_until: string;
  token_serial: string;
  status: "Active" | "Expiring Soon" | "Expired" | "Revoked";
};

export type Notice = {
  notice_id: string;
  client_name: string;
  notice_type: string;
  portal: string;
  notice_date: string;
  response_deadline: string;
  reference_number: string;
  amount: number;
  status: "Open" | "Response Filed" | "Closed" | "Escalated";
  notes: string;
};

export type Timesheet = {
  timesheet_id: string;
  user_name: string;
  client_name: string;
  date: string;
  task_type: string;
  description: string;
  hours: number;
  billable: boolean;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
};

export type Proposal = {
  proposal_id: string;
  lead_id: string;
  prospect_name: string;
  company_name: string;
  entity_type: string;
  services: string;
  fee: string;
  body: string;
  status: "Draft" | "Sent" | "Accepted" | "Declined";
  converted_client_id: string | null;
  created_at: string;
};

export type Campaign = {
  campaign_id: string;
  name: string;
  channel: "WhatsApp" | "Email";
  audience: string;
  subject: string;
  message: string;
  recipients: number;
  status: "Ready" | "Archived";
  created_at: string;
};

export type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: string;
  created_at: string;
};

export type DashboardData = {
  kpis: {
    activeClients: number;
    pendingDocuments: number;
    complianceDueThisWeek: number;
    overdueCompliance: number;
    overdueFees: number;
    totalBilled: number;
    totalCollected: number;
    collectionRate: number;
    pendingTimesheets: number;
    activeNotices: number;
  };
  urgentCompliance: Array<Compliance & { daysUntilDue: number }>;
  recentActivity: AuditEntry[];
  overdueInvoices: Array<Invoice & { daysOverdue: number; balance: number }>;
  revenueByMonth: Array<{ month: string; billed: number; collected: number }>;
};

export type Settings = Record<string, string>;

export type AuthUser = {
  user_id: string;
  username: string;
  name: string;
  email: string;
  role: "partner" | "manager" | "article";
  created_at: string;
  last_login: string | null;
  /** Server-side revocation counter — bumped on logout/password change. */
  token_version?: number;
  /** Service lines this person can be auto-assigned (comma-separated codes). */
  service_lines?: string;
};

export type ClientDetail = {
  client: Client;
  invoices: Invoice[];
  compliance: Compliance[];
  documents: DocumentItem[];
  proposals: Proposal[];
  messages: Message[];
  totals: { billed: number; collected: number; outstanding: number; overdue: number };
  services?: ClientService[];
  requests?: DocumentRequest[];
  timeline?: TaskEvent[];
  registrations?: ClientRegistration[];
  onboarding?: OnboardingAssessment;
  onboarding_tasks?: OnboardingTask[];
  assignments?: AssignmentHistory[];
  audit?: AuditEntry[];
};

export type ReportData = {
  finance: {
    billed: number;
    collected: number;
    outstanding: number;
    overdue: number;
    realization: number;
    avgDaysToPay: number;
  };
  ageing: Array<{ bucket: string; amount: number; count: number }>;
  monthly: Array<{ month: string; billed: number; collected: number }>;
  utilization: Array<{ user: string; hours: number; billable: number; approved: number; clients: number }>;
  compliance: {
    total: number;
    filed: number;
    onTime: number;
    overdue: number;
    dueThisWeek: number;
    byType: Array<{ type: string; open: number; filed: number }>;
  };
  clients: Array<{ client: string; billed: number; collected: number; outstanding: number; wipHours: number }>;
  pipeline: {
    open: number;
    won: number;
    lost: number;
    conversion: number;
    byStage: Array<{ stage: string; count: number }>;
  };
};

export type ApiError = { error: string };

/** Unified reporting filters (Prompt 13). Validated server-side in lib/reports.ts. */
export type ReportFilters = {
  fy?: string;
  assessment_year?: string;
  from?: string;
  to?: string;
  client_id?: string;
  compliance_id?: string;
  period?: string;
  compliance_type?: string;
  service_code?: string;
  assigned_to?: string;
  preparer?: string;
  reviewer?: string;
  manager?: string;
  invoice_status?: string;
  payment_status?: string;
  communication_status?: string;
};

// ── Engagement workflow ───────────────────────────────────────────────────────

/** A recurring (or one-off) service the firm has been engaged to deliver. */
export type ServiceStatus = "Draft" | "Active" | "Paused" | "Completed" | "Cancelled";
export type FeeModel = "fixed" | "recurring" | "per_period" | "milestone" | "one_time";

export type ClientService = {
  service_id: string;
  client_id: string;
  service_code: string;
  service_name: string;
  line: ServiceLine;
  frequency: ServiceFrequency;
  /** Scheduling priority used when the firm sorts generated work. */
  priority?: "Low" | "Normal" | "High";
  /** Days after the internal target before the firm escalates. */
  escalation_days?: number;
  fee: number;
  billing_cycle: BillingCycle;
  auto_invoice: boolean;
  owner: string;
  reviewer: string;
  status: ServiceStatus;
  start_date: string;
  reminder_cap: number;
  reminder_gap_days: number;
  next_cycle_on: string | null;
  created_at: string;
  // ── Service configuration ────────────────────────────────────────────────
  registration_id?: string;
  manager?: string;
  partner?: string;
  end_date?: string;
  fee_model?: FeeModel;
  setup_fee?: number;
  payment_terms_days?: number;
  fee_effective_from?: string;
  approval_stage?: "none" | "review" | "partner";
  paused_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
};

// ── Registrations (a client can hold many, e.g. one GSTIN per state) ─────────
export type RegistrationKind = "GST" | "TAN" | "CIN" | "PAN" | "Other";
export type RegistrationStatus = "Active" | "Suspended" | "Cancelled" | "Needs review";

export type ClientRegistration = {
  registration_id: string;
  client_id: string;
  kind: RegistrationKind;
  /** Masked for ordinary views; the full value is only added server-side. */
  identifier_masked: string;
  identifier?: string;
  legal_name: string;
  state: string;
  state_code: string;
  status: RegistrationStatus;
  effective_from: string;
  effective_to: string;
  place_of_business: string;
  filing_frequency: string;
  is_primary: boolean;
  verification_status: "User entered" | "Externally verified";
  migration_note: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

// ── Onboarding validation ─────────────────────────────────────────────────────
export type OnboardingIssue = {
  scope: "client" | "registration" | "service" | "commercial" | "team" | "communication";
  field?: string;
  service_code?: string;
  message: string;
  severity: "error" | "warning";
};

export type ServiceReadiness = {
  service_code: string;
  service_name: string;
  status: ServiceStatus;
  ready: boolean;
  errors: OnboardingIssue[];
};

export type OnboardingAssessment = {
  client_id: string;
  client_name: string;
  stage: string;
  status: "In progress" | "Active";
  completeness: number;
  can_activate: boolean;
  checklist: Array<{ key: string; label: string; done: boolean; required: boolean; detail: string }>;
  issues: OnboardingIssue[];
  services: ServiceReadiness[];
  active_services: number;
  missing_registrations: string[];
  outstanding_tasks: number;
};

export type OnboardingTask = {
  task_id: string;
  client_id: string;
  service_id: string;
  label: string;
  kind: string;
  status: "Open" | "Done";
  due_date: string;
  created_at: string;
  completed_at: string | null;
};

export type AssignmentRole = "preparer" | "reviewer" | "manager" | "partner" | "relationship_manager";

export type AssignmentHistory = {
  assignment_id: string;
  client_id: string;
  service_id: string;
  role: AssignmentRole;
  assignee: string;
  assigned_by: string;
  assigned_at: string;
  unassigned_at: string | null;
  note: string;
};

/** One period's ask: a packet of documents, with a hard reminder cap. */
export type DocumentRequest = {
  request_id: string;
  client_id: string;
  client_name: string;
  compliance_id: string;
  service_code: string;
  period: string;
  fy: string;
  due_date: string;
  status: "Open" | "Cleared" | "Closed";
  reminder_cap: number;
  reminders_sent: number;
  last_sent_at: string | null;
  next_reminder_on: string | null;
  created_at: string;
  cleared_at: string | null;
  registration_id?: string;
  template_version?: number;
  missing_note?: string;
};

export type FileVersion = {
  version_id: string;
  doc_id: string;
  version: number;
  object_key: string;
  file_name: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: string | null;
  uploaded_at: string;
  status: "current" | "superseded";
  change_reason: string;
  superseded_at: string | null;
};

export type DocumentStatusHistoryEntry = {
  history_id: string;
  doc_id: string;
  from_status: string | null;
  to_status: string;
  actor: string;
  role: string;
  reason: string;
  created_at: string;
};

export type DocumentMigrationReport = {
  at: string;
  scanned: number;
  migrated: number;
  verified: number;
  skipped: number;
  failed: number;
  failures: string[];
};

// ── Staff work management (Prompt 07) ────────────────────────────────────────

/** Why a task cannot proceed right now. Firm-configurable, staff-recordable. */
export type BlockerCategory =
  | "missing_documents"
  | "missing_information"
  | "missing_assignment"
  | "preparation_issue"
  | "review_rejection"
  | "missing_authorization"
  | "filing_dependent"
  | "technical"
  | "other";

const BLOCKER_CATEGORIES: BlockerCategory[] = [
  "missing_documents",
  "missing_information",
  "missing_assignment",
  "preparation_issue",
  "review_rejection",
  "missing_authorization",
  "filing_dependent",
  "technical",
  "other",
];

export function isBlockerCategory(value: unknown): value is BlockerCategory {
  return typeof value === "string" && (BLOCKER_CATEGORIES as string[]).includes(value);
}

export const BLOCKER_CATEGORY_ROW: Record<BlockerCategory, { label: string; hint: string }> = {
  missing_documents: { label: "Missing client documents", hint: "Papers the client still owes for this cycle" },
  missing_information: { label: "Incomplete client information", hint: "Figures or clarifications needed from the client" },
  missing_assignment: { label: "Missing staff assignment", hint: "No preparer/reviewer configured for this stage" },
  preparation_issue: { label: "Preparation issue", hint: "The working papers themselves need attention" },
  review_rejection: { label: "Review rejection", hint: "The reviewer returned the work" },
  missing_authorization: { label: "Missing authorization", hint: "Partner/client approval has not come through yet" },
  filing_dependent: { label: "Filing dependency", hint: "Portal outage, pending evidence or third-party dependency" },
  technical: { label: "Technical failure", hint: "System/infrastructure issue blocking the work" },
  other: { label: "Other", hint: "Anything else — describe it clearly" },
};

export type TaskBlocker = {
  blocker_id: string;
  compliance_id: string;
  client_id: string;
  category: BlockerCategory;
  description: string;
  owner: string;
  status: "open" | "resolved";
  /** Open blockers that block progress gate every workflow transition. */
  blocks_progress: boolean;
  created_by: string;
  created_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_note?: string;
  reopened_at?: string | null;
  reopened_by?: string | null;
};

/** One row per preparer/reviewer set or change on an engagement. Append-only. */
export type TaskAssignmentEntry = {
  assignment_id: string;
  compliance_id: string;
  client_id: string;
  responsibility: "preparer" | "reviewer";
  previous_assignee: string;
  new_assignee: string;
  actor: string;
  actor_role: string;
  reason: string;
  created_at: string;
};

/** Per-employee workload counts, shown only to manager/partner roles. */
export type TeamWorkload = {
  name: string;
  user_id: string;
  role: string;
  service_lines: string;
  preparer_open: number;
  reviewer_open: number;
  overdue: number;
  due_soon: number;
  awaiting_review: number;
  blocked: number;
  completed_this_month: number;
};

/** The audit trail of a filing moving through the practice. */
export type TaskEvent = {
  event_id: string;
  compliance_id: string;
  from_stage: WorkStage | null;
  to_stage: WorkStage;
  actor: string;
  role: string;
  note: string;
  created_at: string;
};

/** A compliance row enriched with document progress for the board. */
export type WorkflowTask = Compliance & {
  stage: WorkStage;
  service_code: string;
  fy: string;
  preparer: string;
  reviewer: string;
  service_name: string;
  line: ServiceLine;
  frequency: ServiceFrequency;
  docs_total: number;
  docs_pending: number;
  docs_received: number;
  docs_verified: number;
  request_id: string | null;
  invoice_id: string | null;
  open_invoice_total: number;
  registration_masked?: string;
  registration_state?: string;
  registration_status?: string;
  /** An open, progress-blocking blocker row exists for this engagement. */
  has_open_blockers?: boolean;
  /** Derived classification shown in the calendar, never a stored status. */
  deadline_state?:
    | "not_due"
    | "due_soon"
    | "due_today"
    | "overdue"
    | "blocked_documents"
    | "blocked_assignment"
    | "awaiting_review"
    | "awaiting_filing_evidence"
    | "completed"
    | "statutory_unknown";
};

export type WorkflowData = {
  tasks: WorkflowTask[];
  stageCounts: Record<WorkStage, number>;
  serviceLines: Array<{ key: ServiceLine; label: string; open: number }>;
  totals: {
    open: number;
    dueThisWeek: number;
    overdue: number;
    docsPending: number;
    awaitingSignoff: number;
    completedThisMonth: number;
    /** Engagements with no preparer or no reviewer configured. */
    unassigned: number;
    /** Engagements blocked (documents, assignment or an explicit blocker). */
    blocked: number;
    /** Engagements sitting in the review stage. */
    awaitingReview: number;
  };
  myWork: WorkflowTask[];
  /** Unassigned engagements in a manager/partner-ready shape. Role-gated. */
  unassigned: WorkflowTask[];
  /** Explicitly blocked engagements needing attention. Role-gated. */
  blocked: WorkflowTask[];
  /** Per-employee counts. Manager/partner roles only; omitted for articles. */
  team?: TeamWorkload[];
  /** Who is reading it — drives which role-gated sections render. */
  viewer_role: string;
};

export type ReminderEngineConfig = {
  reminder_cap: number;
  reminder_gap_days: number;
  auto_billing: boolean;
  invoice_due_days: number;
  gst_rate: number;
  auto_send: boolean;
  provider: "queue" | "cloud";
  last_run_at: string | null;
  last_run_summary: string;
};

export type ReminderRunSummary = {
  ran_at: string;
  requests_considered: number;
  requests_cleared: number;
  requests_closed: number;
  messages_queued: number;
  messages_sent: number;
  invoices_created: number;
  skipped_opt_out: number;
  skipped_cap: number;
  cycles_created: number;
  details: Array<{ client: string; action: string; detail: string }>;
};

// ── Automation layer ──────────────────────────────────────────────────────────

/** The repetitive work a firm does every week, expressed as a runnable rule. */
export type AutomationKind =
  | "chase_documents"
  | "dunning"
  | "generate_compliance"
  | "escalate_overdue"
  | "dsc_watch"
  | "notice_watch";

/** `auto` = a standing approval; `approval` = each run still asks a human. */
export type AutomationMode = "auto" | "approval";
export type AutomationCadence = "daily" | "weekly" | "monthly";

export type AutomationRule = {
  rule_id: string;
  name: string;
  action: AutomationKind;
  params: Record<string, unknown>;
  mode: AutomationMode;
  cadence: AutomationCadence;
  enabled: boolean;
  last_run_at: string | null;
  run_count: number;
  created_by: string;
  created_at: string;
};

export type AutomationRun = {
  run_id: string;
  rule_id: string;
  rule_name: string;
  status: "ok" | "partial" | "skipped" | "failed" | "pending-approval";
  summary: string;
  detail: Record<string, unknown>;
  actor: string;
  started_at: string;
  finished_at: string;
};

// ── Recurring engagement engine (Prompt 05) ─────────────────────────────────

export type DueRuleVerification = "verified" | "unverified";
export type StatutoryRuleStatus = "verified" | "unverified" | "conflicting" | "missing" | "manual_override";

/** A versioned, auditable rule that can yield a statutory due date. */
export type DueDateRule = {
  rule_id: string;
  service_code: string;
  frequency: ServiceFrequency;
  /** Inclusive validity window for the rule, based on the period end date. */
  effective_from: string;
  effective_to: string;
  due_month_offset: number;
  due_day: number;
  /** Days before the statutory date that the firm wants documents/work ready. */
  internal_lead_days: number;
  source: string;
  authority_reference: string;
  verification_status: DueRuleVerification;
  verified_at: string | null;
  verified_by: string;
  version: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type StatusHistoryEntry = {
  history_id: string;
  compliance_id: string;
  from_status: string | null;
  to_status: string;
  from_stage: WorkStage | null;
  to_stage: WorkStage | null;
  actor: string;
  role: string;
  reason: string;
  created_at: string;
};

export type GenerationRun = {
  run_id: string;
  trigger: "manual" | "scheduled";
  actor: string;
  window_from: string;
  window_to: string;
  client_id: string;
  service_id: string;
  status: "completed" | "partial" | "failed" | "preview";
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  warnings: number;
  detail: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
};

export type GenerationPlanItem = {
  service_id: string;
  client_id: string;
  client_name: string;
  service_code: string;
  service_name: string;
  frequency: ServiceFrequency;
  registration_id: string;
  registration_masked: string;
  period: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  fy: string;
  assessment_year: string | null;
  internal_target_date: string;
  statutory_due_date: string | null;
  statutory_rule_status: StatutoryRuleStatus;
  due_rule_id: string | null;
  due_rule_version: number | null;
  due_date_source: string;
  preparer: string;
  reviewer: string;
  manager: string;
  partner: string;
  checklist_version: number;
  action: "create" | "exists" | "skip" | "invalid";
  warnings: string[];
  reason: string;
};
