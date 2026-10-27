import { listClients, listNotices } from "@/lib/db";
import { NoticesView } from "@/components/views/notices";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function NoticesPage() {
  return (
    <>
      <SectionTabs />
      <NoticesView notices={listNotices()} clients={listClients().map((c) => c.name)} />
    </>
  );
}
