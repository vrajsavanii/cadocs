import { createCampaign, listCampaigns } from "@/lib/db";
import { fail, handle, num, ok, pick, readBody, str } from "@/lib/api";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listCampaigns());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const recipients = num(body.recipients, "Recipients", { min: 0, max: 500, optional: true });
    if (!recipients) return fail("Select at least one recipient", 400);

    const campaign = createCampaign({
      name: str(body.name, "Campaign name", { max: 120 }),
      channel: pick<Campaign["channel"]>(body.channel, ["WhatsApp", "Email"], "Channel", "WhatsApp"),
      audience: str(body.audience, "Audience", { max: 80 }),
      subject: str(body.subject, "Subject", { optional: true, max: 160 }),
      message: str(body.message, "Message", { max: 1200 }),
      recipients,
      status: "Ready",
    });

    return ok(campaign, 201);
  } catch (err) {
    return handle(err);
  }
}
