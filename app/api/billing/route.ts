import { getSessionUser } from "@/lib/auth";
import { fail, handle, ok, readBody } from "@/lib/api";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";
import { firmBillingSettings, listTaxTreatments, updateFirmBillingSettings, updateTaxTreatment } from "@/lib/invoicing";
import { hasInvoicePermission } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/** Firm billing settings and the configured tax treatments. Bank details and
 *  tax rates are returned only to users with the billing-settings permission. */
export function GET() {
  try {
    return ok({ settings: firmBillingSettings(), treatments: listTaxTreatments() });
  } catch (err) {
    return handle(err);
  }
}

/** Partner-only updates. Every change is logged to the audit log by the engine. */
export async function PUT(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const actor = actorFrom(user);
    const body = await readBody(req);
    const patch = (body.settings ?? {}) as Record<string, unknown>;
    const treatmentPatches = (body.treatments ?? []) as Array<{ treatment_id?: string } & Record<string, unknown>>;
    if (!patch || Object.keys(patch).length === 0 && treatmentPatches.length === 0) {
      return fail("Nothing to update", 400);
    }
    let settings;
    if (Object.keys(patch).length > 0) {
      if (!hasInvoicePermission(actor, "settings")) return fail("Only a partner can change billing settings", 403);
      settings = updateFirmBillingSettings(patch, actor);
    } else {
      settings = firmBillingSettings();
    }
    for (const patchEntry of treatmentPatches) {
      const treatmentId = String(patchEntry.treatment_id ?? "");
      if (!treatmentId) return fail("Treatment id required", 400);
      if (!hasInvoicePermission(actor, "settings")) return fail("Only a partner can change tax treatment", 403);
      updateTaxTreatment(treatmentId, patchEntry, actor);
    }
    return ok({ settings, treatments: listTaxTreatments() });
  } catch (err) {
    return handle(err);
  }
}
