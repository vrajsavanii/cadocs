// routes/invoiceRoutes.js
// Invoices & Automated Fee Recovery API
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const groqService = require('../services/groqService');
const { daysFromToday, nowISO } = require('../utils/helpers');
const { keys } = require('../config/keys');
const razorpayService = require('../services/razorpayService');
const { validateInvoice } = require('../validators/invoiceValidator');
const { logAudit } = require('../middleware/auditLogger');

// GET /api/invoices — List all invoices
router.get('/', async (req, res) => {
  try {
    const invoices = await sheetsService.getAllInvoices();
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: 'Could not load invoices' });
  }
});

// POST /api/invoices — Create new invoice with Joi validation & audit log
router.post('/', async (req, res) => {
  try {
    const { error, value } = validateInvoice(req.body);
    if (error) {
      return res.status(400).json({ error: error.details.map((d) => d.message).join(', ') });
    }

    const allInvoices = await sheetsService.getAllInvoices();
    const invoiceId = value.invoice_id || `INV-${String(allInvoices.length + 1).padStart(3, '0')}`;

    const newInvoice = {
      invoice_id: invoiceId,
      client_id: value.client_id,
      client_name: value.client_name || '',
      service_description: value.service_description,
      amount: value.amount,
      due_date: value.due_date,
      invoice_date: value.invoice_date || new Date().toISOString().slice(0, 10),
      status: value.status || 'Pending',
      payment_link: value.payment_link || '',
      reminder_count: 0,
      escalated: 'No',
    };

    await sheetsService.appendRow(sheetsService.TABS.INVOICES, newInvoice);

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.name,
      action: 'CREATE',
      entityType: 'invoice',
      entityId: invoiceId,
      newValue: newInvoice,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, invoice: newInvoice });
  } catch (err) {
    console.error('[INVOICE] Create error:', err.message);
    res.status(500).json({ error: 'Could not create invoice' });
  }
});

// POST /api/invoices/:invoiceId/payment-link — Generate Razorpay payment link
router.post('/:invoiceId/payment-link', async (req, res) => {
  try {
    const invoices = await sheetsService.getAllInvoices();
    const inv = invoices.find((i) => i.invoice_id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const linkResult = await razorpayService.createInvoicePaymentLink({
      invoiceId: inv.invoice_id,
      amount: inv.amount,
      clientName: inv.client_name,
      clientPhone: inv.phone,
      clientEmail: inv.email,
      description: `Invoice #${inv.invoice_id} - ${inv.service_description || 'Professional CA Services'}`,
    });

    if (linkResult.shortUrl) {
      await sheetsService.updateRow(sheetsService.TABS.INVOICES, 'invoice_id', inv.invoice_id, {
        payment_link: linkResult.shortUrl,
      });

      // Optionally send on WhatsApp if requested
      if (req.body.sendWhatsApp && inv.phone) {
        const msg = `Dear ${inv.client_name},\n\nPlease find your secure online payment link for Invoice #${inv.invoice_id} (₹${inv.amount}):\n👉 ${linkResult.shortUrl}\n\nYou can pay instantly using UPI (GPay, PhonePe), Cards, or Net Banking.\n— ${keys.FIRM_NAME}`;
        await whatsappService.sendTextMessage(inv.phone, msg);
      }
    }

    res.json({ success: true, link: linkResult });
  } catch (err) {
    console.error('[INVOICE] Payment link generation error:', err.message);
    res.status(500).json({ error: 'Could not generate payment link' });
  }
});

// POST /api/invoices/:invoiceId/remind — Unified reminder endpoint (Prompt 11)
router.post('/:invoiceId/remind', async (req, res) => {
  try {
    const { channel = 'whatsapp' } = req.body;
    const invoices = await sheetsService.getAllInvoices();
    const inv = invoices.find((i) => i.invoice_id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const daysDiff = daysFromToday(inv.due_date);
    const daysOverdue = daysDiff !== null ? -daysDiff : 0;
    const amountFormatted = (parseFloat(inv.amount) || 0).toLocaleString('en-IN');

    let stage = 'invoice_upcoming';
    if (daysDiff === 0) stage = 'invoice_due_today';
    else if (daysOverdue > 15) stage = 'invoice_severe';
    else if (daysOverdue > 0) stage = 'invoice_overdue';

    const message = await groqService.draftMessage(stage, {
      clientName: inv.client_name,
      invoiceId: inv.invoice_id,
      amount: amountFormatted,
      dueDate: inv.due_date,
      daysOverdue: Math.max(0, daysOverdue),
      firmName: keys.FIRM_NAME,
    });

    if (channel === 'whatsapp' && inv.phone) {
      await whatsappService.sendTextMessage(inv.phone, message);
    } else if (channel === 'email' && inv.email) {
      await emailService.sendEmail(
        inv.email,
        `Payment Reminder — Invoice ${inv.invoice_id} (${keys.FIRM_NAME})`,
        message
      );
    }

    await sheetsService.Invoices.update('invoice_id', inv.invoice_id, {
      reminder_count: (parseInt(inv.reminder_count) || 0) + 1,
      last_reminder_date: nowISO(),
    });

    res.json({ success: true, message: `${channel.toUpperCase()} reminder sent` });
  } catch (err) {
    console.error('[INVOICE] Error sending reminder:', err.message);
    res.status(500).json({ error: 'Could not send reminder' });
  }
});

// Backward-compatible WhatsApp reminder
router.post('/:invoiceId/remind-whatsapp', async (req, res) => {
  try {
    const invoices = await sheetsService.getAllInvoices();
    const inv = invoices.find((i) => i.invoice_id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const daysDiff = daysFromToday(inv.due_date);
    const daysOverdue = daysDiff !== null ? -daysDiff : 0;
    const amountFormatted = (parseFloat(inv.amount) || 0).toLocaleString('en-IN');
    let stage = 'invoice_upcoming';
    if (daysDiff === 0) stage = 'invoice_due_today';
    else if (daysOverdue > 15) stage = 'invoice_severe';
    else if (daysOverdue > 0) stage = 'invoice_overdue';
    const message = await groqService.draftMessage(stage, { clientName: inv.client_name, invoiceId: inv.invoice_id, amount: amountFormatted, dueDate: inv.due_date, daysOverdue: Math.max(0, daysOverdue), firmName: keys.FIRM_NAME });
    if (inv.phone) await whatsappService.sendTextMessage(inv.phone, message);
    await sheetsService.Invoices.update('invoice_id', inv.invoice_id, { reminder_count: (parseInt(inv.reminder_count) || 0) + 1, last_reminder_date: nowISO() });
    res.json({ success: true, message: 'WhatsApp reminder sent' });
  } catch (err) {
    console.error('[INVOICE] Error sending WhatsApp reminder:', err.message);
    res.status(500).json({ error: 'Could not send reminder' });
  }
});

// Backward-compatible Email reminder
router.post('/:invoiceId/remind-email', async (req, res) => {
  try {
    const invoices = await sheetsService.getAllInvoices();
    const inv = invoices.find((i) => i.invoice_id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const daysDiff = daysFromToday(inv.due_date);
    const daysOverdue = daysDiff !== null ? -daysDiff : 0;
    const amountFormatted = (parseFloat(inv.amount) || 0).toLocaleString('en-IN');
    let stage = 'invoice_upcoming';
    if (daysDiff === 0) stage = 'invoice_due_today';
    else if (daysOverdue > 15) stage = 'invoice_severe';
    else if (daysOverdue > 0) stage = 'invoice_overdue';
    const message = await groqService.draftMessage(stage, { clientName: inv.client_name, invoiceId: inv.invoice_id, amount: amountFormatted, dueDate: inv.due_date, daysOverdue: Math.max(0, daysOverdue), firmName: keys.FIRM_NAME });
    if (inv.email) await emailService.sendEmail(inv.email, `Payment Reminder — Invoice ${inv.invoice_id} (${keys.FIRM_NAME})`, message);
    await sheetsService.Invoices.update('invoice_id', inv.invoice_id, { reminder_count: (parseInt(inv.reminder_count) || 0) + 1, last_reminder_date: nowISO() });
    res.json({ success: true, message: 'Email reminder sent' });
  } catch (err) {
    console.error('[INVOICE] Error sending Email reminder:', err.message);
    res.status(500).json({ error: 'Could not send reminder' });
  }
});

// PUT /api/invoices/:invoiceId/mark-paid — 1-click settlement + thank you
router.put('/:invoiceId/mark-paid', async (req, res) => {
  try {
    const invoices = await sheetsService.getAllInvoices();
    const inv = invoices.find((i) => i.invoice_id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    await sheetsService.updateInvoiceStatus(inv.invoice_id, 'Paid');

    // Async thank-you note
    setImmediate(async () => {
      try {
        const thankYouMsg = await groqService.draftMessage('invoice_paid', {
          clientName: inv.client_name,
          invoiceId: inv.invoice_id,
          amount: (parseFloat(inv.amount) || 0).toLocaleString('en-IN'),
          firmName: keys.FIRM_NAME,
        });

        if (inv.phone) await whatsappService.sendTextMessage(inv.phone, thankYouMsg);
        if (inv.email) await emailService.sendEmail(inv.email, `Payment Received — Invoice ${inv.invoice_id}`, thankYouMsg);
      } catch (e) {
        console.warn('[INVOICE] Thank you dispatch note:', e.message);
      }
    });

    res.json({ success: true, message: `Invoice ${inv.invoice_id} marked Paid` });
  } catch (err) {
    res.status(500).json({ error: 'Could not mark invoice paid' });
  }
});

// PUT /api/invoices/:invoiceId/status — Generic status update
router.put('/:invoiceId/status', async (req, res) => {
  try {
    const { status = 'Paid' } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    await sheetsService.updateInvoiceStatus(req.params.invoiceId, status);
    res.json({ success: true, message: `Invoice updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not update invoice status' });
  }
});

module.exports = router;
