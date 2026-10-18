import { getReports } from "@/lib/db";
import { ReportsView } from "@/components/views/reports";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  return <ReportsView data={getReports()} />;
}
