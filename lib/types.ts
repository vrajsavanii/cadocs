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
};

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

export type Compliance = {
  compliance_id: string;
  client_id: string;
  client_name: string;
  compliance_type: string;
  period: string;
  due_date: string;
  status: "Pending" | "In Progress" | "Filed" | "Overdue";
  filed_date: string | null;
  ack_number: string | null;
  assigned_to: string;
  notes: string;
};

export type DocumentItem = {
  doc_id: string;
  client_id: string;
  client_name: string;
  document_name: string;
  status: "Pending" | "Received" | "Verified" | "Rejected";
  requested_date: string;
  received_date: string | null;
  notes: string;
  file_name: string | null;
  file_size: number | null;
  file_path: string | null;
  uploaded_at: string | null;
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
    openLeads: number;
    hotLeads: number;
    pendingTimesheets: number;
    activeNotices: number;
  };
  urgentCompliance: Array<Compliance & { daysUntilDue: number }>;
  recentActivity: AuditEntry[];
  overdueInvoices: Array<Invoice & { daysOverdue: number; balance: number }>;
  revenueByMonth: Array<{ month: string; billed: number; collected: number }>;
  pipeline: Array<{ status: string; count: number }>;
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
};

export type ClientDetail = {
  client: Client;
  invoices: Invoice[];
  compliance: Compliance[];
  documents: DocumentItem[];
  proposals: Proposal[];
  messages: Message[];
  totals: { billed: number; collected: number; outstanding: number; overdue: number };
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
