import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const priorEnv: Record<string, string | undefined> = {
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
};

beforeAll(() => {
  process.env.WHATSAPP_APP_SECRET = "app-secret-for-tests-0001";
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-for-tests-0001";
});

afterAll(() => {
  for (const key of Object.keys(priorEnv)) {
    if (priorEnv[key] === undefined) delete (process.env as Record<string, unknown>)[key];
    else process.env[key] = priorEnv[key];
  }
});

const { createMessage, setProviderMessageId } = await import("../lib/db");

/** POST helper that signs the raw body exactly like Meta does. */
async function postSigned(body: unknown, secretOverride = process.env.WHATSAPP_APP_SECRET!): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const signature = createHmac("sha256", secretOverride).update(raw).digest("hex");
  const { POST } = await import("../app/api/webhooks/whatsapp/route");
  return POST(
    new Request("https://nexagent.example/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${signature}`, "content-type": "application/json" },
      body: raw,
    }),
  );
}

describe("DEF-004 regression: WhatsApp status webhooks", () => {
  it("rejects an unsigned request even when the JSON is valid", async () => {
    const { POST } = await import("../app/api/webhooks/whatsapp/route");
    const res = await POST(
      new Request("https://nexagent.example/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a body signed with the wrong secret", async () => {
    const res = await postSigned({ object: "whatsapp_business_account", entry: [] }, "a-different-secret");
    expect(res.status).toBe(403);
  });

  it("maps delivered and read receipts back onto the outbox row", async () => {
    const message = createMessage({
      channel: "WhatsApp",
      recipient_name: "Ravi Test Client",
      to_address: "919900010000",
      subject: "Documents for GSTR-1 · Apr 2026",
      body: "Please share the sales register.",
      related_type: "document_request",
      related_id: "REQ-TEST-1",
      status: "Sent",
      kind: "document_request",
      reminder_number: 0,
      sent_at: new Date().toISOString(),
      error: "",
      automation_key: "",
    });
    setProviderMessageId(message.message_id, "wamid.TESTDELIVERED1");

    const statusEvent = (status: string) => ({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.TESTDELIVERED1", status, timestamp: "1718000000", recipient_id: "919900010000" }] } }] }],
    });

    const delivered = await postSigned(statusEvent("delivered"));
    expect(delivered.status).toBe(200);
    const deliveredBody = (await delivered.json()) as { applied: string[] };
    expect(deliveredBody.applied).toEqual([`${message.message_id}→Delivered`]);

    const read = await postSigned(statusEvent("read"));
    const readBody = (await read.json()) as { applied: string[] };
    expect(readBody.applied).toEqual([`${message.message_id}→Read`]);

    const { findMessageByProviderId } = await import("../lib/db");
    const final = findMessageByProviderId("wamid.TESTDELIVERED1");
    expect(final?.status).toBe("Read");
  });

  it("records Meta's failure text when a send is reported failed", async () => {
    const message = createMessage({
      channel: "WhatsApp",
      recipient_name: "Sita Test Client",
      to_address: "919900020000",
      subject: "Invoice reminder",
      body: "Your invoice is due.",
      related_type: "invoice",
      related_id: "INV-TEST-1",
      status: "Sent",
      kind: "invoice",
      reminder_number: 1,
      sent_at: new Date().toISOString(),
      error: "",
      automation_key: "",
    });
    setProviderMessageId(message.message_id, "wamid.TESTFAILED1");

    const res = await postSigned({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.TESTFAILED1", status: "failed", errors: [{ message: "Recipient phone number is not a WhatsApp user" }] }] } }] }],
    });
    const body = (await res.json()) as { applied: string[] };
    expect(body.applied).toEqual([`${message.message_id}→Failed`]);

    const { findMessageByProviderId } = await import("../lib/db");
    const final = findMessageByProviderId("wamid.TESTFAILED1");
    expect(final?.status).toBe("Failed");
    expect(final?.error).toContain("not a WhatsApp user");
  });

  it("answers the subscription handshake only with the exact verify token", async () => {
    const { GET } = await import("../app/api/webhooks/whatsapp/route");
    const good = new Request("https://nexagent.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-for-tests-0001&hub.challenge=abc123");
    const res = await GET(good);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");

    const bad = new Request("https://nexagent.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123");
    expect((await GET(bad)).status).toBe(403);
  });
});
