// schedulers/complianceReminder.js
// Daily 09:00 AM IST: Statutory Compliance Deadline & Penalty Engine Cron
// CA Firm Automation Suite

const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const telegramService = require('../services/telegramService');
const groqService = require('../services/groqService');
const penaltyCalc = require('../utils/penaltyCalc');
const { daysFromToday, nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');
const { keys } = require('../config/keys');

async function runComplianceReminder() {
  console.log('\n⏰ [09:00 AM IST] Running Compliance Deadline Reminders...');
  let sentCount = 0;
  let overdueCount = 0;
  let urgentCount = 0;
  let upcomingCount = 0;

  try {
    const allCompliance = await sheetsService.getAllCompliance();
    const active = allCompliance.filter((r) => r.status !== 'Filed');

    for (const record of active) {
      const daysUntilDue = daysFromToday(record.due_date);
      if (daysUntilDue === null) continue;

      // Don't resend if already reminded in the last 20 hours
      if (record.last_reminder_date) {
        const lastRem = new Date(record.last_reminder_date).getTime();
        if (Date.now() - lastRem < 20 * 60 * 60 * 1000) {
          continue;
        }
      }

      let eventType = null;
      let penaltyNotice = '';

      if (daysUntilDue < 0) {
        // OVERDUE
        eventType = 'compliance_overdue';
        overdueCount++;
        const daysLate = Math.abs(daysUntilDue);
        penaltyNotice = penaltyCalc.getPenaltySummary(record.compliance_type, daysLate, 0);

        // Update status in sheet if not already marked Overdue
        if (record.status !== 'Overdue') {
          await sheetsService.updateComplianceStatus(record.compliance_id, 'Overdue');
        }

        // Alert partner if severely overdue (>3 days)
        if (daysLate > 3) {
          await telegramService.sendAlert(
            `<b>🚨 Statutory Default Risk</b>\nClient: ${record.client_name}\nType: ${record.compliance_type}\nDue: ${record.due_date} (${daysLate} days late)\n${penaltyNotice}`,
            'critical'
          );
        }
      } else if (daysUntilDue === 0) {
        eventType = 'compliance_1d'; // Due today
        urgentCount++;
      } else if (daysUntilDue <= 3) {
        eventType = 'compliance_3d';
        urgentCount++;
      } else if (daysUntilDue <= 7) {
        eventType = 'compliance_7d';
        upcomingCount++;
      }

      if (!eventType) continue;

      try {
        const context = {
          clientName: record.client_name,
          complianceType: record.compliance_type,
          dueDate: record.due_date,
          daysLeft: daysUntilDue,
          penalty: penaltyNotice,
          firmName: keys.FIRM_NAME,
          firmPhone: keys.FIRM_PHONE,
        };

        const message = await groqService.draftMessage(eventType, context);

        // Dispatch via WhatsApp
        if (record.phone) {
          await whatsappService.sendTextMessage(record.phone, message);
        }

        // Dispatch via Email
        if (record.email) {
          await emailService.sendEmail(
            record.email,
            `Important: ${record.compliance_type} due on ${record.due_date}`,
            message
          );
        }

        // Update reminder counter
        const reminderCount = (parseInt(record.reminder_count) || 0) + 1;
        await sheetsService.Compliance.update('compliance_id', record.compliance_id, {
          reminder_count: reminderCount,
          last_reminder_date: nowISO(),
        });

        sentCount++;
        console.log(`  ✅ Reminder sent → ${record.client_name} (${record.compliance_type}) [${eventType}]`);
      } catch (itemErr) {
        logError('Compliance Reminder', record.compliance_id, itemErr.message);
      }
    }

    // Daily brief to partner Telegram
    const summaryMsg = `<b>📊 Compliance Morning Brief (${new Date().toLocaleDateString('en-IN')})</b>
✅ <b>Reminders Dispatched:</b> ${sentCount}
🚨 <b>Overdue Filings:</b> ${overdueCount}
⚠️ <b>Due in &le;3 Days:</b> ${urgentCount}
📋 <b>Due this Week:</b> ${upcomingCount}`;

    await telegramService.sendAlert(summaryMsg, overdueCount > 0 ? 'urgent' : 'normal');
    console.log(`⏰ Compliance Reminders completed: ${sentCount} sent.\n`);
  } catch (err) {
    console.error('❌ runComplianceReminder error:', err.message);
    logError('Compliance Scheduler', 'run()', err.message);
  }
}

function start() {
  // 09:00 AM IST every day
  cron.schedule('0 9 * * *', runComplianceReminder, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  run: runComplianceReminder,
  runComplianceReminder,
};
