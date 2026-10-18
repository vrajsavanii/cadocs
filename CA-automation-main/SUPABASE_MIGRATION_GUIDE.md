# Supabase & PostgreSQL Migration Guide
## CA Firm Automation Suite

This guide explains how to migrate your CA Firm practice database from Google Sheets to **Supabase (PostgreSQL)** for enterprise scalability, ACID transactions, and zero-concurrency issues.

---

### Step 1: Create a Free Supabase Project
1. Go to [https://supabase.com](https://supabase.com) and click **Sign Up** / **New Project**.
2. Name your project: `ca-firm-suite`
3. Set your database password and choose region (e.g. `ap-south-1` Mumbai).
4. Wait ~2 minutes for the database to provision.

---

### Step 2: Run the Database Schema SQL
1. Open the **SQL Editor** tab in your Supabase dashboard.
2. Open [`backend/supabase/schema.sql`](file:///Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA%20automation/backend/supabase/schema.sql).
3. Copy and paste the entire script into the SQL Editor.
4. Click **Run**.
5. All 11 tables (`clients`, `compliance_items`, `document_items`, `invoices`, `leads`, `users`, `audit_logs`, `udin_records`, `dsc_records`, `notices`, `timesheets`) will be created with primary keys, foreign key cascades, and performance indices.

---

### Step 3: Configure Environment Variables
In your `backend/.env` file, add:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

### Step 4: One-Click Data Migration from Sheets
Run the migration script to copy all live rows from Google Sheets into Supabase:
```bash
node backend/scripts/migrateSheetsToSupabase.js
```

---

### Benefits of Supabase for CA Firms:
- **Zero Race Conditions:** Real row-locking and atomic transactions.
- **Role-Based Security:** Row Level Security (RLS) ensures junior articles cannot access partner billing data.
- **Audit Trails:** Immutable append-only `audit_logs` meet ICAI SA-230 documentation requirements.
- **Speed:** Sub-50ms query responses vs 500ms–1500ms Google Sheets API latencies.
- **Free Tier:** 500MB database + 50,000 monthly active users at zero cost.
