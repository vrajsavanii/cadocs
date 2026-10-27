import { listProposals } from "@/lib/db";
import { ProposalsView } from "@/components/views/proposals";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function ProposalsPage() {
  return (
    <>
      <SectionTabs />
      <ProposalsView proposals={listProposals()} />
    </>
  );
}
