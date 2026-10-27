import { getUnifiedReports, parseReportFilters } from "@/lib/reports";
import type { AuthUser } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { ReportsView, type FilterOptions } from "@/components/views/reports";
import { SectionTabs } from "@/components/section-tabs";
import { listClients, listInvoices, listCompliance, listUsers } from "@/lib/db";
import { SERVICES, fyForDate } from "@/lib/services";
import { fyForDateSafe } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") raw[key] = value;
  }
  const { filters, invalid } = parseReportFilters(raw);
  const user: AuthUser | null = await getSessionUser();
  const pack = getUnifiedReports(filters, user);

  const clients = listClients().map((c) => ({ id: c.client_id, name: c.name }));
  const staff = listUsers().map((u) => ({ name: u.name, role: u.role }));
  const serviceOptions = SERVICES.map((s) => ({ code: s.code, name: s.name }));
  const fySet = new Set<string>([fyForDateSafe(new Date().toISOString())]);
  inv: for (const inv of listInvoices()) if (inv.fy) fySet.add(inv.fy);
  for (const task of listCompliance()) {
    const fy = task.fy || fyForDate(task.due_date);
    if (fy) fySet.add(fy);
  }
  const fyOptions = Array.from(fySet).sort((a, b) => b.localeCompare(a));

  const options: FilterOptions = { clients, staff, services: serviceOptions, fyOptions };
  return (
    <>
      <SectionTabs />
      <ReportsView pack={{ ...pack, filter_warnings: invalid }} user={user} options={options} />
    </>
  );
}
