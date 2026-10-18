import { listClients, listCompliance, listDocuments, listInvoices, listLeads, listPayments, listTimesheets } from "@/lib/db";
import { fail, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

type Row = Array<string | number | boolean | null | undefined>;

function toCsv(headers: string[], rows: Row[]): string {
  const escape = (value: string | number | boolean | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\r\n");
}

export function GET(req: Request) {
  try {
    const type = new URL(req.url).searchParams.get("type") ?? "clients";
    let headers: string[] = [];
    let rows: Row[] = [];

    if (type === "clients") {
      headers = ["Client ID", "Name", "Contact", "Phone", "Email", "Entity", "GSTIN", "PAN", "Services", "City", "State", "Since"];
      rows = listClients().map((c) => [c.client_id, c.name, c.contact_person, c.phone, c.email, c.entity_type, c.gst_number, c.pan, c.services_opted, c.city, c.state, c.created_at.slice(0, 10)]);
    } else if (type === "invoices") {
      headers = ["Invoice", "Client", "Invoice date", "Due date", "Description", "Taxable", "GST", "Total", "Paid", "Balance", "Status", "Paid on"];
      rows = listInvoices().map((i) => [i.invoice_id, i.client_name, i.invoice_date, i.due_date, i.service_description, i.amount, i.gst_amount, i.total_amount, i.paid_amount, i.total_amount - i.paid_amount, i.status, i.paid_date ?? ""]);
    } else if (type === "payments") {
      headers = ["Payment", "Invoice", "Client", "Amount", "Paid on", "Mode", "Reference", "Notes"];
      rows = listPayments().map((p) => [p.payment_id, p.invoice_id, p.client_name, p.amount, p.paid_on, p.mode, p.reference, p.notes]);
    } else if (type === "compliance") {
      headers = ["Task ID", "Client", "Type", "Period", "Due date", "Status", "Filed on", "Acknowledgement", "Assigned to", "Notes"];
      rows = listCompliance().map((c) => [c.compliance_id, c.client_name, c.compliance_type, c.period, c.due_date, c.status, c.filed_date ?? "", c.ack_number ?? "", c.assigned_to, c.notes]);
    } else if (type === "documents") {
      headers = ["Document ID", "Client", "Document", "Status", "Requested", "Received", "File", "Notes"];
      rows = listDocuments().map((d) => [d.doc_id, d.client_name, d.document_name, d.status, d.requested_date, d.received_date ?? "", d.file_name ?? "", d.notes]);
    } else if (type === "timesheets") {
      headers = ["Entry", "Staff", "Client", "Date", "Task", "Description", "Hours", "Billable", "Status"];
      rows = listTimesheets().map((t) => [t.timesheet_id, t.user_name, t.client_name, t.date, t.task_type, t.description, t.hours, t.billable ? "Yes" : "No", t.status]);
    } else if (type === "leads") {
      headers = ["Lead", "Name", "Company", "Phone", "Email", "Source", "Interest", "Score", "Category", "Stage", "Notes"];
      rows = listLeads().map((l) => [l.lead_id, l.name, l.company_name, l.phone, l.email, l.source, l.service_interest, l.lead_score, l.category, l.status, l.notes]);
    } else {
      return fail("Unknown export type", 400);
    }

    const csv = `\uFEFF${toCsv(headers, rows)}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handle(err);
  }
}
