/**
 * Server-side invoice PDF renderer.
 *
 * A minimal, dependency-free PDF writer: one page of Helvetica text assembled
 * from the *persisted* issue snapshot of an issued invoice. Deliberately
 * boring and deterministic — the PDF is a faithful rendering of frozen data,
 * never a recomputation. Non-Latin characters (₹, Devanagari) are not in the
 * base-font WinAnsi map, so rupee amounts render as "Rs." — documented in
 * docs/product/INVOICING-AND-BILLING.md.
 */
import type { Invoice } from "./types";

type SnapshotLine = {
  seq: number;
  description: string;
  quantity: number;
  unit_price_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
  tax_kind: string;
};

type IssueSnapshot = {
  issued_at: string;
  issued_by: string;
  number: string;
  fy: string;
  firm: {
    legal_name: string;
    display_name: string;
    address: string;
    contact: string;
    pan: string;
    gstin: string;
    payment_instructions: string;
    bank_details: string;
    invoice_footer: string;
  };
  client: {
    name: string;
    contact_person: string;
    address: string;
    gstin: string;
    state: string;
    gst_state_code: string;
  };
  lines: SnapshotLine[];
  totals: { taxable_paise: number; gst_paise: number; total_paise: number };
  notes: string;
  paid_paise?: number;
};

export function parseIssueSnapshot(invoice: Invoice): IssueSnapshot | null {
  try {
    const parsed = JSON.parse(invoice.issue_snapshot || "") as IssueSnapshot;
    if (!parsed || !Array.isArray(parsed.lines) || !parsed.totals || !parsed.firm || !parsed.client) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Indian digit grouping: 1234567.89 → "12,34,567.89". */
export function formatInrPaise(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100).toString();
  const p = (abs % 100).toString().padStart(2, "0");
  let grouped: string;
  if (rupees.length > 3) {
    const last3 = rupees.slice(-3);
    const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  } else {
    grouped = rupees;
  }
  return `${negative ? "-" : ""}${grouped}.${p}`;
}

function pdfEscape(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, (ch) => (ch === "₹" ? "Rs." : " "))
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

type TextOp = { x: number; y: number; size: number; text: string; bold?: boolean };

/** Builds the single-page A4 PDF (595×842 pt) for an issued invoice. */
export function renderInvoicePdf(invoice: Invoice, snapshot: IssueSnapshot, paidPaise: number, creditPaise: number): Buffer {
  const ops: TextOp[] = [];
  let y = 812;
  const leftX = 48;
  const centerX = 300;
  const rightX = 547;

  const push = (text: string, x: number, rightFrom: number, size: number, bold = false) => {
    for (const piece of wrapLine(text, rightFrom - x > 320 ? 46 : Math.floor((rightFrom - x) / (size * 0.55)))) {
      ops.push({ x, y, size, text: piece, bold });
      y -= size + 4;
    }
  };
  const pushRight = (text: string, rightFrom: number, size: number, bold = false) => {
    const est = Math.ceil(text.length * size * 0.55);
    ops.push({ x: rightFrom - est, y, size, text, bold });
    y -= size + 4;
  };

  // Header
  push(snapshot.firm.legal_name, leftX, 320, 16, true);
  for (const line of snapshot.firm.address.split("\n").slice(0, 3)) push(line, leftX, 320, 9);
  if (snapshot.firm.contact) push(`Contact: ${snapshot.firm.contact}`, leftX, 320, 9);
  push(`TAX INVOICE`, centerX, rightX, 18, true);
  y -= 8;
  pushRight(`No. ${snapshot.number}`, rightX, 11, true);
  pushRight(`Date: ${invoice.invoice_date}`, rightX, 9);
  pushRight(`Due date: ${invoice.due_date}`, rightX, 9);
  if (snapshot.fy) pushRight(`FY ${snapshot.fy}`, rightX, 9);
  if (snapshot.firm.gstin) pushRight(`Firm GSTIN: ${snapshot.firm.gstin}`, rightX, 9);
  if (snapshot.firm.pan) pushRight(`Firm PAN: ${snapshot.firm.pan}`, rightX, 9);
  y -= 10;

  // Bill-to block
  push("BILL TO", leftX, 320, 10, true);
  push(snapshot.client.name, leftX, 320, 11, true);
  if (snapshot.client.contact_person) push(`Attn: ${snapshot.client.contact_person}`, leftX, 320, 9);
  for (const line of snapshot.client.address.split("\n").slice(0, 3)) push(line, leftX, 320, 9);
  if (snapshot.client.gstin) push(`GSTIN: ${snapshot.client.gstin}`, leftX, 320, 9);
  if (snapshot.client.gst_state_code || snapshot.client.state) push(`Place of supply: ${snapshot.client.state || ""} ${snapshot.client.gst_state_code}`.trim(), leftX, 320, 9);
  y -= 12;

  // Line table
  const colX = { desc: 48, qty: 300, rate: 340, disc: 400, taxable: 448, tax: 496, total: 547 };
  ops.push({ x: colX.desc, y, size: 9, text: "Description", bold: true });
  ops.push({ x: colX.qty - 12, y, size: 9, text: "Qty", bold: true });
  ops.push({ x: colX.rate - 40, y, size: 9, text: "Rate", bold: true });
  ops.push({ x: colX.disc - 40, y, size: 9, text: "Disc.", bold: true });
  ops.push({ x: colX.taxable - 40, y, size: 9, text: "Taxable", bold: true });
  ops.push({ x: colX.tax - 40, y, size: 9, text: "Tax", bold: true });
  ops.push({ x: colX.total - 44, y, size: 9, text: "Total", bold: true });
  y -= 3;
  ops.push({ x: leftX, y, size: 7, text: "_".repeat(93) });
  y -= 9;
  const rowLimit = Math.max(1, Math.floor((y - 220) / 12));
  for (const line of snapshot.lines.slice(0, rowLimit)) {
    const tax = line.cgst_paise + line.sgst_paise + line.igst_paise;
    const descParts = wrapLine(line.description, 42);
    descParts.forEach((piece, i) => {
      if (i === 0 && y > 100) {
        ops.push({ x: colX.desc, y, size: 8, text: piece });
        ops.push({ x: colX.qty - 4, y, size: 8, text: String(line.quantity) });
        ops.push({ x: colX.rate - 40, y, size: 8, text: formatInrPaise(line.unit_price_paise) });
        ops.push({ x: colX.disc - 40, y, size: 8, text: line.discount_paise ? formatInrPaise(line.discount_paise) : "-" });
        ops.push({ x: colX.taxable - 40, y, size: 8, text: formatInrPaise(line.taxable_paise) });
        ops.push({ x: colX.tax - 40, y, size: 8, text: tax ? `${formatInrPaise(tax)} (${line.cgst_paise || line.sgst_paise ? "CGST+SGST" : "IGST"})` : "-" });
        ops.push({ x: colX.total - 44, y, size: 8, text: formatInrPaise(line.line_total_paise) });
      } else if (i > 0) {
        ops.push({ x: colX.desc, y, size: 8, text: piece });
      }
      if (i < descParts.length - 1) y -= 10;
    });
    y -= 12;
  }
  y -= 6;
  ops.push({ x: leftX, y, size: 7, text: "_".repeat(93) });
  y -= 12;

  // Totals
  pushRight(`Taxable: ${formatInrPaise(snapshot.totals.taxable_paise)}`, rightX, 9);
  pushRight(`GST: ${formatInrPaise(snapshot.totals.gst_paise)}`, rightX, 9);
  pushRight(`Total: ${formatInrPaise(snapshot.totals.total_paise)}`, rightX, 10, true);
  if (paidPaise > 0) pushRight(`Recorded payments: ${formatInrPaise(paidPaise)}`, rightX, 9);
  if (creditPaise > 0) pushRight(`Credit notes: ${formatInrPaise(creditPaise)}`, rightX, 9);
  pushRight(`Balance due: ${formatInrPaise(snapshot.totals.total_paise - paidPaise - creditPaise)}`, rightX, 10, true);
  y -= 14;

  // Payment info
  if (snapshot.firm.bank_details || snapshot.firm.payment_instructions) {
    push("Payment details", leftX, 320, 9, true);
    for (const line of `${snapshot.firm.bank_details}\n${snapshot.firm.payment_instructions}`.split("\n").filter(Boolean).slice(0, 6)) {
      push(line, leftX, 320, 8);
    }
  }
  if (snapshot.notes) {
    push("Notes", leftX, 320, 9, true);
    for (const line of wrapLine(snapshot.notes, 52).slice(0, 4)) push(line, leftX, 320, 8);
  }
  if (snapshot.firm.invoice_footer) {
    y = Math.min(y, 84);
    for (const line of wrapLine(snapshot.firm.invoice_footer, 60).slice(0, 2)) push(line, leftX, 320, 8);
  }

  const contentLines: string[] = [];
  contentLines.push("BT");
  for (const op of ops) {
    const font = op.bold ? "/F2" : "/F1";
    contentLines.push(`${font} ${op.size} Tf`);
    contentLines.push(`1 0 0 1 ${op.x.toFixed(1)} ${Math.max(20, Math.min(830, op.y)).toFixed(1)} Tm`);
    contentLines.push(`(${pdfEscape(op.text).slice(0, 200)}) Tj`);
  }
  contentLines.push("ET");
  const content = contentLines.join("\n");

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
