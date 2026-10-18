import { deleteClient, getClient, getClientDetail, updateClient } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import type { Client } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const detail = getClientDetail(id);
    if (!detail) return fail("Client not found", 404);
    return ok(detail);
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    const body = await readBody(req);
    const patch: Partial<Omit<Client, "client_id" | "created_at">> = {};

    if (body.name !== undefined) patch.name = str(body.name, "Client name", { max: 120 });
    if (body.contact_person !== undefined) patch.contact_person = str(body.contact_person, "Contact person", { optional: true, max: 120 });
    if (body.phone !== undefined) {
      const phone = str(body.phone, "Phone (WhatsApp)", { max: 20 }).replace(/\D/g, "");
      if (phone.length < 10) return fail("Phone must contain at least 10 digits");
      patch.phone = phone;
    }
    if (body.email !== undefined) {
      const email = str(body.email, "Email", { optional: true, max: 160 });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail("Enter a valid email address");
      patch.email = email;
    }
    if (body.entity_type !== undefined) patch.entity_type = str(body.entity_type, "Entity type", { max: 60 });
    if (body.gst_number !== undefined) {
      const gstin = str(body.gst_number, "GSTIN", { optional: true, max: 20 }).toUpperCase();
      if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin)) return fail("GSTIN must be 15 characters (e.g. 27AABCS1234A1Z5)");
      patch.gst_number = gstin;
    }
    if (body.pan !== undefined) {
      const pan = str(body.pan, "PAN", { optional: true, max: 12 }).toUpperCase();
      if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return fail("PAN must be 10 characters (e.g. AABCS1234A)");
      patch.pan = pan;
    }
    if (body.services_opted !== undefined) patch.services_opted = str(body.services_opted, "Services", { optional: true, max: 200 });
    if (body.city !== undefined) patch.city = str(body.city, "City", { optional: true, max: 80 });
    if (body.state !== undefined) patch.state = str(body.state, "State", { optional: true, max: 80 });

    if (Object.keys(patch).length === 0) return fail("No client fields supplied");
    const updated = updateClient(id, patch);
    if (!updated) return fail("Client not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const result = deleteClient(id);
    if (!result.ok) {
      if (result.blockers.includes("Client not found")) return fail("Client not found", 404);
      return fail(`Cannot delete this client while linked records exist: ${result.blockers.join(", ")}`, 409);
    }
    return ok({ deleted: id });
  } catch (err) {
    return handle(err);
  }
}
