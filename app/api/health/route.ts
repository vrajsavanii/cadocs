import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const settings = getSettings();
  return NextResponse.json({
    status: "ok",
    message: "CA Firm Automation API is running",
    firm: settings.firm_name ?? "Sharma & Associates",
    version: "3.0.0",
    stack: "Next.js 16 · React 19 · SQLite",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
