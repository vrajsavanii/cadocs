import { createMessage, listMessages } from "@/lib/db";
import { fail, handle, ok, pick, readBody, str } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listMessages());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const channel = pick(body.channel, ["WhatsApp", "Email"] as const, "Channel", "WhatsApp");
    const toAddress = str(body.to_address, channel === "Email" ? "Email address" : "Phone number", { max: 120 });
    if (channel === "Email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toAddress)) {
      return fail("Enter a valid email address", 400);
    }
    const message = createMessage({
      channel,
      recipient_name: str(body.recipient_name, "Recipient", { max: 140 }),
      to_address: toAddress,
      subject: str(body.subject, "Subject", { optional: true, max: 160 }),
      body: str(body.body, "Message", { max: 1500 }),
      related_type: str(body.related_type, "Related type", { optional: true, max: 40 }),
      related_id: str(body.related_id, "Related record", { optional: true, max: 60 }),
      status: "Logged",
    });
    return ok(message, 201);
  } catch (err) {
    return handle(err);
  }
}
