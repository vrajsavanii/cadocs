const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const telegramService = require('../services/telegramService');
const { daysFromToday } = require('../utils/helpers');
const { keys } = require('../config/keys');
const { logError } = require('../utils/errorHandler');

async function runDscExpiryCheck() {
  console.log('\n⏰ [08:00 AM IST] Running DSC Expiry Alerts...');
  let sentCount = 0;

  try {
    const dscRecords = await sheetsService.readSheet('DSC_Records');
    
    for (const record of dscRecords) {
      if (record.is_active === 'false' || record.is_active === false) continue;
      
      const daysLeft = daysFromToday(record.valid_until);
      
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) {
        const firmName = keys.FIRM_NAME || 'CA Firm';
        const message = `🔐 DSC EXPIRY ALERT: ${record.dsc_holder_name}'s ${record.class_type || ''} Digital Signature Certificate expires on ${record.valid_until} (${daysLeft} days). Used for: ${record.purpose || 'N/A'}. Client: ${record.client_name}. Please renew urgently to avoid filing disruption. — ${firmName}`;
        
        if (record.phone) {
          try {
            await whatsappService.sendTextMessage(record.phone, message);
          } catch (e) {
            logError('DSC Expiry WhatsApp', record.client_name, e.message);
          }
        }
        
        try {
          await telegramService.sendAlert(
            `<b>🚨 DSC Expiry Warning</b>\n${message}`,
            daysLeft <= 7 ? 'urgent' : 'normal'
          );
        } catch (e) {
          logError('DSC Expiry Telegram', record.client_name, e.message);
        }
        
        sentCount++;
      }
    }
    console.log(`⏰ DSC Expiry Alerts completed: ${sentCount} sent.\n`);
  } catch (err) {
    console.error('❌ runDscExpiryCheck error:', err.message);
    logError('DSC Expiry Scheduler', 'run()', err.message);
  }
}

function start() {
  // 08:00 AM IST every day
  cron.schedule('0 8 * * *', runDscExpiryCheck, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  runDscExpiryCheck,
};
