import { listClients, listTimesheets } from "@/lib/db";
import { TimesheetsView } from "@/components/views/timesheets";

export const dynamic = "force-dynamic";

export default function TimesheetsPage() {
  return <TimesheetsView entries={listTimesheets()} clients={listClients().map((c) => c.name)} />;
}
