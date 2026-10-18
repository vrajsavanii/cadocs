// schedulers/leadFollowup.js
// Daily 10:00 AM IST: Automated Inbound Lead Proposal & Follow-up Cron
// CA Firm Automation Suite

const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const groqService = require('../services/groqService');
const { todayISO, addDays, nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');
const { keys } = require('../config/keys');

const CLOSED_STATUSES = ['Converted', 'Lost', 'Cold-Closed'];

async function runLeadFollowup() {
  console.log('\n⏰ [10:00 AM IST] Running Lead Proposal Follow-ups...');
  let sentCount = 0;

  try {
    const allLeads = await sheetsService.getAllLeads();
    const today = todayISO();

    for (const lead of allLeads) {
      if (CLOSED_STATUSES.includes(lead.status)) continue;
      if (!lead.followup_date) continue;
      if (String(lead.followup_date).slice(0, 10) > today) continue;

      try {
        const attempts = parseInt(lead.followup_attempts) || 0;
        const nextAttempt = attempts + 1;

        const context = {
          clientName: lead.name,
          requirement: lead.requirement || 'your tax and accounting requirement',
          firmName: keys.FIRM_NAME,
        };

        const message = await groqService.draftMessage('lead_followup', context);

        if (lead.phone) {
          await whatsappService.sendTextMessage(lead.phone, message);
        }

        if (lead.email) {
          await emailService.sendEmail(
            lead.email,
            `Following up regarding your inquiry — ${keys.FIRM_NAME}`,
            message
          );
        }

        const maxReached = nextAttempt >= 4;
        await sheetsService.Leads.update('phone', lead.phone, {
          followup_attempts: nextAttempt,
          followup_date: maxReached ? '' : addDays(3),
          status: maxReached ? 'Cold-Closed' : lead.status,
        });

        sentCount++;
        console.log(`  ✅ Lead follow-up sent → ${lead.name} [Attempt #${nextAttempt}${maxReached ? ' - Cold Closed' : ''}]`);
      } catch (itemErr) {
        logError('Lead Followup', lead.lead_id, itemErr.message);
      }
    }

    console.log(`⏰ Lead Follow-ups completed: ${sentCount} sent.\n`);
  } catch (err) {
    console.error('❌ runLeadFollowup error:', err.message);
    logError('Lead Followup Scheduler', 'run()', err.message);
  }
}

function start() {
  // 10:00 AM IST every day
  cron.schedule('0 10 * * *', runLeadFollowup, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  run: runLeadFollowup,
  runLeadFollowup,
};
