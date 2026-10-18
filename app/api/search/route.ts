import { listClients, listCompliance, listDocuments, listInvoices, listLeads, listNotices } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return ok({ groups: [] });
    const has = (value: string | null | undefined) => (value ?? "").toLowerCase().includes(q);

    const clients = listClients()
      .filter((c) => has(c.name) || has(c.phone) || has(c.email) || has(c.gst_number) || has(c.pan))
      .slice(0, 5)
      .map((c) => ({ id: c.client_id, label: c.name, sublabel: `${c.entity_type} · ${c.city || "No city"}`, href: `/clients?client=${c.client_id}` }));

    const leads = listLeads()
      .filter((l) => has(l.name) || has(l.company_name) || has(l.phone))
      .slice(0, 4)
      .map((l) => ({ id: l.lead_id, label: l.name, sublabel: `${l.company_name || "Lead"} · ${l.status}`, href: "/leads" }));

    const invoices = listInvoices()
      .filter((i) => has(i.invoice_id) || has(i.client_name) || has(i.service_description))
      .slice(0, 4)
      .map((i) => ({ id: i.invoice_id, label: i.invoice_id, sublabel: `${i.client_name} · ${i.status}`, href: "/invoices" }));

    const compliance = listCompliance()
      .filter((c) => has(c.client_name) || has(c.compliance_type))
      .slice(0, 4)
      .map((c) => ({ id: c.compliance_id, label: c.compliance_type, sublabel: `${c.client_name} · ${c.status}`, href: "/compliance" }));

    const documents = listDocuments()
      .filter((d) => has(d.document_name) || has(d.client_name))
      .slice(0, 4)
      .map((d) => ({ id: d.doc_id, label: d.document_name, sublabel: `${d.client_name} · ${d.status}`, href: "/documents" }));

    const notices = listNotices()
      .filter((n) => has(n.client_name) || has(n.notice_type) || has(n.reference_number))
      .slice(0, 3)
      .map((n) => ({ id: n.notice_id, label: n.notice_type, sublabel: `${n.client_name} · ${n.status}`, href: "/notices" }));

    return ok({
      groups: [
        { title: "Clients", items: clients },
        { title: "Leads", items: leads },
        { title: "Invoices", items: invoices },
        { title: "Compliance", items: compliance },
        { title: "Documents", items: documents },
        { title: "Notices", items: notices },
      ],
    });
  } catch (err) {
    return handle(err);
  }
}
