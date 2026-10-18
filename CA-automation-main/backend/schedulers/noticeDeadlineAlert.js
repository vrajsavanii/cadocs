const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const telegramService = require('../services/telegramService');
const { daysFromToday } = require('../utils/helpers');
const { keys } = require('../config/keys');
const { logError } = require('../utils/errorHandler');

async function runNoticeAlert() {
  console.log('\n⏰ [09:15 AM IST] Running Notice Deadline Alerts...');
  let sentCount = 0;

  try {
    const notices = await sheetsService.readSheet('Notices');
    
    for (const record of notices) {
      if (record.status !== 'open') continue;
      
      const daysLeft = daysFromToday(record.response_deadline);
      
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) {
        const firmName = keys.FIRM_NAME || 'CA Firm';
        const message = `⚠️ NOTICE DEADLINE ALERT: ${record.client_name} has a ${record.notice_type} (${record.portal}) notice with response deadline on ${record.response_deadline} (${daysLeft} days). Reference: ${record.reference_number}. Amount: ₹${record.amount_in_dispute || '0'}. Please take immediate action. — ${firmName}`;
        
        // 4-7 days: standard reminder (WhatsApp + normal TG or just WhatsApp)
        // <=3 days: Telegram escalation + WhatsApp
        if (record.phone) {
          try {
            await whatsappService.sendTextMessage(record.phone, message);
          } catch (e) {
            logError('Notice Alert WhatsApp', record.client_name, e.message);
          }
        }
        
        if (daysLeft <= 3) {
          try {
            await telegramService.sendAlert(
              `<b>🚨 CRITICAL NOTICE ESCALATION</b>\n${message}`,
              'critical'
            );
          } catch (e) {
             logError('Notice Alert Telegram', record.client_name, e.message);
          }
        }
        
        sentCount++;
      }
    }
    console.log(`⏰ Notice Deadline Alerts completed: ${sentCount} sent.\n`);
  } catch (err) {
    console.error('❌ runNoticeAlert error:', err.message);
    logError('Notice Deadline Scheduler', 'run()', err.message);
  }
}

function start() {
  // 09:15 AM IST every day
  cron.schedule('15 9 * * *', runNoticeAlert, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  runNoticeAlert,
};
