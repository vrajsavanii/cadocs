// schedulers/invoiceFollowup.js
// Daily 10:30 AM IST: Automated Fee Recovery & Invoice Reminders Cron
// CA Firm Automation Suite

const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const telegramService = require('../services/telegramService');
const groqService = require('../services/groqService');
const { daysFromToday, nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');
const { keys } = require('../config/keys');

async function runInvoiceFollowup() {
  console.log('\n⏰ [10:30 AM IST] Running Fee Recovery Reminders...');
  let sentCount = 0;
  let severeOverdueCount = 0;

  try {
    const allInvoices = await sheetsService.getAllInvoices();
    const unpaid = allInvoices.filter((i) => i.status !== 'Paid');

    for (const inv of unpaid) {
      const daysDiff = daysFromToday(inv.due_date);
      if (daysDiff === null) continue;

      const daysOverdue = -daysDiff; // positive means past due

      // Check last reminder timestamp (at least 24 hours gap)
      if (inv.last_reminder_date) {
        const lastRem = new Date(inv.last_reminder_date).getTime();
        if (Date.now() - lastRem < 24 * 60 * 60 * 1000) {
          continue;
        }
      }

      let eventType = null;
      if (daysDiff > 0 && daysDiff <= 3) {
        eventType = 'invoice_upcoming';
      } else if (daysDiff === 0) {
        eventType = 'invoice_due_today';
      } else if (daysOverdue >= 1 && daysOverdue <= 7) {
        eventType = 'invoice_overdue';
      } else if (daysOverdue >= 8 && daysOverdue <= 15) {
        eventType = 'invoice_overdue';
      } else if (daysOverdue > 15) {
        eventType = 'invoice_severe';
        severeOverdueCount++;
      }

      if (!eventType) continue;

      try {
        const amountNum = parseFloat(inv.amount || 0);
        const formattedAmount = amountNum.toLocaleString('en-IN');

        const context = {
          clientName: inv.client_name,
          invoiceId: inv.invoice_id,
          amount: formattedAmount,
          dueDate: inv.due_date,
          daysOverdue: Math.max(0, daysOverdue),
          firmName: keys.FIRM_NAME,
        };

        const message = await groqService.draftMessage(eventType, context);

        // WhatsApp
        if (inv.phone) {
          await whatsappService.sendTextMessage(inv.phone, message);
        }

        // Email
        if (inv.email) {
          await emailService.sendEmail(
            inv.email,
            `Invoice ${inv.invoice_id} Statement — ${keys.FIRM_NAME}`,
            message
          );
        }

        // Escalation alert for > 15 days overdue
        const isSevere = daysOverdue > 15;
        if (isSevere) {
          await telegramService.sendEscalationAlert(
            inv.client_name,
            formattedAmount,
            daysOverdue,
            inv.invoice_id
          );
        }

        const reminderCount = (parseInt(inv.reminder_count) || 0) + 1;
        await sheetsService.Invoices.update('invoice_id', inv.invoice_id, {
          status: daysOverdue > 0 ? 'Overdue' : inv.status,
          reminder_count: reminderCount,
          last_reminder_date: nowISO(),
          escalated: isSevere ? 'Yes' : inv.escalated || 'No',
        });

        sentCount++;
        console.log(`  ✅ Payment reminder sent → ${inv.client_name} (Inv #${inv.invoice_id}) [${eventType}]`);
      } catch (itemErr) {
        logError('Invoice Followup', inv.invoice_id, itemErr.message);
      }
    }

    console.log(`⏰ Fee Recovery Reminders done: ${sentCount} sent, ${severeOverdueCount} escalated.\n`);
  } catch (err) {
    console.error('❌ runInvoiceFollowup error:', err.message);
    logError('Invoice Scheduler', 'run()', err.message);
  }
}

function start() {
  // 10:30 AM IST every day
  cron.schedule('30 10 * * *', runInvoiceFollowup, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  run: runInvoiceFollowup,
  runInvoiceFollowup,
};
