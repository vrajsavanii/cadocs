/**
 * WhatsApp delivery with an honest default.
 *
 * Without Meta credentials this app does what every self-hosted practice tool
 * can: it prepares the message, stores it in the outbox and gives a one-tap
 * `wa.me` link. When the firm has a WhatsApp Business Cloud API number and an
 * approved utility template, `WHATSAPP_AUTO_SEND=1` turns the same queued
 * message into a real template send.
 *
 * Meta rules encoded here:
 *   • business-initiated messages need an approved template outside the 24-hour
 *     customer-service window, so the Cloud path only ever sends a template;
 *   • the client must have opted in — the caller checks `whatsapp_opt_in`;
 *   • a template send is accepted by the API, not proof of delivery (webhooks
 *     are a separate integration).
 */
import { createMessage, getDb, getSettings, markMessageStatus, setProviderMessageId } from "./db";
import type { Message } from "./types";

export type WhatsAppConfig = {
  provider: "queue" | "cloud";
  configured: boolean;
  autoSend: boolean;
  templateName: string;
  language: string;
  missing: string[];
};

export function whatsappConfig(): WhatsAppConfig {
  const settings = getSettings();
  const token = process.env.WHATSAPP_TOKEN?.trim() ?? "";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const templateName = (process.env.WHATSAPP_TEMPLATE_NAME || settings.whatsapp_template_name || "").trim();
  const language = (process.env.WHATSAPP_TEMPLATE_LANG || settings.whatsapp_template_lang || "en").trim();
  const autoSend = process.env.WHATSAPP_AUTO_SEND === "1" && Boolean(token && phoneId && templateName);
  const missing: string[] = [];
  if (!token) missing.push("WHATSAPP_TOKEN");
  if (!phoneId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!templateName) missing.push("WHATSAPP_TEMPLATE_NAME");
  return {
    provider: token && phoneId ? "cloud" : "queue",
    configured: Boolean(token && phoneId && templateName),
    autoSend,
    templateName,
    language,
    missing,
  };
}

type DeliverInput = {
  to: string;
  recipient: string;
  subject: string;
  body: string;
  kind: Message["kind"];
  relatedType: string;
  relatedId: string;
  reminderNumber?: number;
  automationKey?: string;
  templateParams?: string[];
};

/** Queues the message, then attempts a Cloud API send only when fully configured. */
export async function deliverWhatsApp(input: DeliverInput): Promise<Message> {
  const message = createMessage({
    channel: "WhatsApp",
    recipient_name: input.recipient,
    to_address: input.to,
    subject: input.subject,
    body: input.body,
    related_type: input.relatedType,
    related_id: input.relatedId,
    status: "Queued",
    kind: input.kind,
    reminder_number: input.reminderNumber ?? 0,
    sent_at: null,
    error: "",
    automation_key: input.automationKey ?? "",
  });

  const config = whatsappConfig();
  if (!config.configured || !config.autoSend || !input.to) return message;

  const params = (input.templateParams ?? [input.recipient, input.subject, input.body]).map((value) =>
    String(value).replace(/\s+/g, " ").trim().slice(0, 900),
  );
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normaliseWaNumber(input.to),
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.language },
      components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [],
    },
  };

  try {
    const version = process.env.WHATSAPP_GRAPH_VERSION || "v26.0";
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
      messages?: Array<{ id?: string }>;
    };
    if (!res.ok) {
      const error = (data.error?.message || `WhatsApp API returned ${res.status}`).slice(0, 300);
      getDb().prepare("UPDATE messages SET status='Failed', error=? WHERE message_id=?").run(error, message.message_id);
      return { ...message, status: "Failed", error };
    }
    // DEF-004: an accepted send is only a *submission* proof. Meta answers
    // with its own message id — remember it so the status webhook can map
    // delivery/read receipts back to the outbox row.
    const providerId = (data.messages?.[0]?.id || "").trim();
    if (providerId) setProviderMessageId(message.message_id, providerId);
    const sent = markMessageStatus(message.message_id, "Sent");
    getDb().prepare("UPDATE messages SET sent_at=? WHERE message_id=?").run(new Date().toISOString(), message.message_id);
    const base = (sent ?? { ...message, status: "Sent" }) as Message;
    return { ...base, provider_message_id: providerId || null, sent_at: base.sent_at || new Date().toISOString() };
  } catch (err) {
    const error = (err instanceof Error ? err.message : "WhatsApp send failed").slice(0, 300);
    getDb().prepare("UPDATE messages SET status='Failed', error=? WHERE message_id=?").run(error, message.message_id);
    return { ...message, status: "Failed", error };
  }
}

export function normaliseWaNumber(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** `wa.me` deep link for the outbox and client-facing screens. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${normaliseWaNumber(phone)}?text=${encodeURIComponent(message)}`;
}
