import { listClients, listDsc } from "@/lib/db";
import { DscView } from "@/components/views/dsc";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function DscPage() {
  return (
    <>
      <SectionTabs />
      <DscView records={listDsc()} clients={listClients().map((c) => c.name)} />
    </>
  );
}
