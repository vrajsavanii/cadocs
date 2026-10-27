import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { actorFrom } from "@/lib/billing-actor";
import { readInvoicePdf } from "@/lib/invoicing";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Streams the privately stored invoice PDF.
 *
 * - Signed-in staff: session + view permission.
 * - External recipients (WhatsApp): a short-lived signed download token bound
 *   to this exact invoice id — the same scoping used for client documents.
 *   No permanent public URL is ever issued, and the token never grants access
 *   to anything except this one invoice's bytes.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const user = token ? null : await getSessionUser();
    const viewer = user ? actorFrom(user) : null;
    const pdf = await readInvoicePdf(id, viewer, token);
    if (!pdf) return NextResponse.json({ error: "PDF not available for this invoice" }, { status: 404 });
    const pdfName = `${pdf.invoice.invoice_number || pdf.invoice.invoice_id}.pdf`;
    return new NextResponse(new Uint8Array(pdf.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handle(err);
  }
}
