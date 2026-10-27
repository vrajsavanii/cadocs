import { listClients, listTimesheets } from "@/lib/db";
import { TimesheetsView } from "@/components/views/timesheets";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function TimesheetsPage() {
  return (
    <>
      <SectionTabs />
      <TimesheetsView entries={listTimesheets()} clients={listClients().map((c) => c.name)} />
    </>
  );
}
