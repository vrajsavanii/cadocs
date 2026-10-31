import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Availability probe for uptime monitors and load balancers.
 *
 * V1 audit DEF-003: this endpoint is public (the edge proxy deliberately lets
 * it through), so it used to leak the firm name, the internal version, the
 * stack composition and process uptime — fingerprints that make targeted
 * attacks trivial. A liveness probe needs exactly one fact: the process is up
 * and can reach its configuration. Detailed diagnostics belong in server logs,
 * not a public response body.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
