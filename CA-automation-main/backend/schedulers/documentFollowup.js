// schedulers/documentFollowup.js
// Daily 09:30 AM IST: Automated Document Follow-ups Cron
// CA Firm Automation Suite

const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const telegramService = require('../services/telegramService');
const groqService = require('../services/groqService');
const { daysSince, nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');
const { keys } = require('../config/keys');

async function runDocumentFollowup() {
  console.log('\n⏰ [09:30 AM IST] Running Document Follow-ups...');
  let sentCount = 0;

  try {
    const allDocs = await sheetsService.getAllDocuments();
    const pendingDocs = allDocs.filter((d) => d.status === 'Pending');

    for (const doc of pendingDocs) {
      const followupCount = parseInt(doc.followup_count) || 0;
      if (followupCount >= 4) {
        // Max chase limit reached
        continue;
      }

      const refDate = doc.last_followup_date || doc.requested_date;
      const gapDays = daysSince(refDate);

      // Follow up every 3 days
      if (gapDays === null || gapDays < 3) continue;

      try {
        const nextAttempt = followupCount + 1;
        const context = {
          clientName: doc.client_name,
          documentName: doc.document_name,
          complianceType: doc.compliance_type,
          followupCount: nextAttempt,
          firmName: keys.FIRM_NAME,
        };

        const message = await groqService.draftMessage('document_followup', context);

        if (doc.phone) {
          await whatsappService.sendTextMessage(doc.phone, message);
        }

        if (doc.email) {
          await emailService.sendEmail(
            doc.email,
            `Required Document: ${doc.document_name} (${doc.compliance_type})`,
            message
          );
        }

        await sheetsService.updateDocumentStatus(doc.doc_id, 'Pending');
        await sheetsService.Documents.update('doc_id', doc.doc_id, {
          followup_count: nextAttempt,
          last_followup_date: nowISO(),
        });

        // If 3rd+ attempt, escalate to Senior Partner on Telegram
        if (nextAttempt >= 3) {
          await telegramService.sendAlert(
            `<b>📄 Document Stalled (${nextAttempt} Follow-ups Sent)</b>\nClient: ${doc.client_name}\nFile: ${doc.document_name}\nFiling: ${doc.compliance_type}\n<i>Action: Call client directly to prevent filing delay.</i>`,
            'urgent'
          );
        }

        sentCount++;
        console.log(`  ✅ Doc follow-up sent → ${doc.client_name} (${doc.document_name}) [Attempt #${nextAttempt}]`);
      } catch (itemErr) {
        logError('Document Followup', doc.doc_id, itemErr.message);
      }
    }

    console.log(`⏰ Document Follow-ups completed: ${sentCount} sent.\n`);
  } catch (err) {
    console.error('❌ runDocumentFollowup error:', err.message);
    logError('Document Followup Scheduler', 'run()', err.message);
  }
}

function start() {
  // 09:30 AM IST every day
  cron.schedule('30 9 * * *', runDocumentFollowup, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  run: runDocumentFollowup,
  runDocumentFollowup,
};
