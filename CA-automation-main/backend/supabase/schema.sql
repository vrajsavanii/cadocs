-- ==============================================================================
-- CA FIRM AUTOMATION SUITE — PRODUCTION DATABASE SCHEMA
-- PostgreSQL / Supabase Migration
-- Part 5 Database Architecture
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. USERS (FIRM STAFF & ACCESS ROLES) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('partner', 'manager', 'article', 'client_view')),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. CLIENTS MASTER DIRECTORY ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_code TEXT UNIQUE NOT NULL,
  firm_name TEXT NOT NULL,
  contact_name TEXT,
  entity_type TEXT CHECK (entity_type IN ('pvt_ltd', 'llp', 'partnership', 'proprietorship', 'individual', 'trust', 'huf', 'other')),
  pan TEXT,
  gstin TEXT,
  whatsapp TEXT NOT NULL,
  email TEXT,
  city TEXT,
  state TEXT,
  gst_filing_type TEXT DEFAULT 'monthly' CHECK (gst_filing_type IN ('monthly', 'qrmp', 'nil', 'none')),
  tds_deductor BOOLEAN DEFAULT false,
  audit_required BOOLEAN DEFAULT false,
  itr_form TEXT,
  onboarded_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. STATUTORY COMPLIANCE ITEMS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  period TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'filed', 'missed')),
  filed_date DATE,
  ack_number TEXT,
  penalty_accrued NUMERIC(12,2) DEFAULT 0,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  reminder_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 4. DOCUMENT TRACKER & INTELLIGENCE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  compliance_item_id UUID REFERENCES compliance_items(id) ON DELETE SET NULL,
  document_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'verified', 'rejected')),
  received_date DATE,
  file_url TEXT,
  classified_type TEXT,
  uploaded_by TEXT DEFAULT 'firm',
  followup_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 5. INVOICES & FEE RECOVERY ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  service_description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'overdue', 'paid', 'cancelled')),
  paid_date DATE,
  payment_ref TEXT,
  razorpay_link TEXT,
  reminder_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 6. LEADS PIPELINE (CRM) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  company_name TEXT,
  entity_type TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  services_required TEXT[],
  turnover TEXT,
  lead_score INTEGER DEFAULT 50,
  lead_category TEXT DEFAULT 'warm' CHECK (lead_category IN ('hot', 'warm', 'cold')),
  stage TEXT DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost')),
  source TEXT DEFAULT 'Website',
  proposal_sent_date DATE,
  estimated_fee TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 7. UDIN REGISTER ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS udin_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  udin TEXT UNIQUE NOT NULL,
  ca_member_no TEXT NOT NULL,
  document_type TEXT NOT NULL,
  financial_year TEXT,
  generated_date DATE NOT NULL DEFAULT CURRENT_DATE,
  report_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 8. DSC REGISTER ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dsc_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  dsc_holder_name TEXT NOT NULL,
  class_type TEXT DEFAULT 'Class 3',
  valid_from DATE,
  valid_until DATE NOT NULL,
  token_serial TEXT,
  issuing_ca TEXT,
  purpose TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 9. NOTICE INBOX ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  portal TEXT DEFAULT 'GST',
  notice_date DATE NOT NULL,
  response_deadline DATE NOT NULL,
  reference_number TEXT,
  tax_period TEXT,
  amount_in_dispute NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'response_filed', 'closed', 'escalated')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 10. TIMESHEETS (STAFF BILLABLE HOURS) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  task_type TEXT NOT NULL,
  task_description TEXT NOT NULL,
  hours NUMERIC(4,2) NOT NULL,
  billable BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 11. AUDIT LOG (APPEND-ONLY SA-230 COMPLIANCE) ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── PERFORMANCE INDICES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_compliance_due_date ON compliance_items(due_date);
CREATE INDEX IF NOT EXISTS idx_compliance_client ON compliance_items(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON document_items(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_notices_deadline ON notices(response_deadline);
CREATE INDEX IF NOT EXISTS idx_dsc_valid_until ON dsc_records(valid_until);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
