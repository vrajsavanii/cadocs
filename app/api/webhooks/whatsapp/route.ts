import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Cloud API status webhooks (V1 audit DEF-004).
 *
 * The outbox could send through Meta but never learned what happened next:
 * delivery and read receipts went nowhere and messages sat on "Sent" forever.
 * This route closes that loop with the two endpoints Meta defines:
 *
 *   GET  — the one-time subscription handshake. Meta asks for
 *          `hub.challenge` to be echoed when `hub.verify_token` matches
 *          WHATSAPP_VERIFY_TOKEN.
 *   POST — every subsequent event. It is authenticated by verifying
 *          `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with
 *          WHATSAPP_APP_SECRET — compare in constant time) before parsing.
 *
 * Status events only: `sent` (already recorded at send time), `delivered`,
 * `read`, and `failed` (with Meta's error text). Inbound document messages are
 * acknowledged but not yet processed into the document store — the document
 * pipeline keeps its own upload flow. `WHATSAPP_VERIFY_TOKEN` and
 * `WHATSAPP_APP_SECRET` must both be set; without them nothing is accepted.
 */
import { NextResponse } from "next/server";
import { findMessageByProviderId, markMessageStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET implements Meta's subscription verification challenge. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";
  const expected = (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();

  if (mode === "subscribe" && expected && verify(token, expected)) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

function verify(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: Array<{ message?: string; title?: string; code?: number }>;
        }>;
      };
    }>;
  }>;
};

/** Canonical Meta status → outbox status. Unknown statuses are ignored. */
function mapStatus(metaStatus: string): string | null {
  switch (metaStatus) {
    case "sent":
      return null; // already recorded when the Cloud API accepted the send
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "failed":
      return "Failed";
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const secret = (process.env.WHATSAPP_APP_SECRET || "").trim();
  const signature = (req.headers.get("x-hub-signature-256") || "").trim();
  if (!secret || !signature.startsWith("sha256=")) {
    return NextResponse.json({ error: "Forbidden — missing WHATSAPP_APP_SECRET or signature" }, { status: 403 });
  }

  const raw = await req.text();
  const expectedMac = createHmac("sha256", secret).update(raw).digest("hex");
  const givenMac = signature.slice("sha256=".length);
  try {
    const a = Buffer.from(givenMac, "hex");
    const b = Buffer.from(expectedMac, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("mismatch");
  } catch {
    return NextResponse.json({ error: "Forbidden — signature verification failed" }, { status: 403 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(raw) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  let acknowledged = 0;
  const applied: string[] = [];
  if (payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, accepted: 0, note: "unrecognised object type" });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const status of change.value?.statuses ?? []) {
        acknowledged += 1;
        const providerId = (status.id || "").trim();
        if (!providerId) continue;
        const message = findMessageByProviderId(providerId);
        if (!message) continue; // not one of ours (or the row predates the loop closure)
        const target = mapStatus((status.status || "").toLowerCase());
        if (!target) continue;
        const error =
          target === "Failed"
            ? (status.errors?.[0]?.message || status.errors?.[0]?.title || "Meta reported a delivery failure").slice(0, 300)
            : "";
        markMessageStatus(message.message_id, target, error);
        applied.push(`${message.message_id}→${target}`);
      }
    }
  }

  // Always 200 once the signature is valid — Meta retries on non-2xx forever.
  return NextResponse.json({ ok: true, accepted: acknowledged, applied });
}
