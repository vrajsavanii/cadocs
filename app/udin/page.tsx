import { listClients, listUdin } from "@/lib/db";
import { UdinView } from "@/components/views/udin";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function UdinPage() {
  return (
    <>
      <SectionTabs />
      <UdinView records={listUdin()} clients={listClients().map((c) => c.name)} />
    </>
  );
}
