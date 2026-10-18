const cron = require('node-cron');
const sheetsService = require('../services/sheetsService');
const telegramService = require('../services/telegramService');
const morningBrief = require('../ai/morningBrief');
const { keys } = require('../config/keys');
const { logError } = require('../utils/errorHandler');

async function runMorningBrief() {
  console.log('\n⏰ [08:45 AM IST] Generating Morning Brief...');

  try {
    // Gather data from sheetsService
    const complianceData = await sheetsService.getAllCompliance().catch(() => []);
    
    let invoices = [];
    try { invoices = await sheetsService.readSheet('Invoices'); } catch (e) { /* fallback */ }
    
    let leads = [];
    try { leads = await sheetsService.readSheet('Leads'); } catch (e) { /* fallback */ }
    
    let documents = [];
    try { documents = await sheetsService.readSheet('Documents'); } catch (e) { /* fallback */ }
    
    let dscRecords = [];
    try { dscRecords = await sheetsService.readSheet('DSC_Records'); } catch (e) { /* fallback */ }
    
    let notices = [];
    try { notices = await sheetsService.readSheet('Notices'); } catch (e) { /* fallback */ }

    // Filter relevant subsets
    const allData = {
      compliance: complianceData.filter(c => c.status !== 'Filed' && c.due_date),
      invoices: invoices.filter(i => i.status === 'overdue' || i.status === 'Overdue'),
      leads: leads.filter(l => l.status === 'new' || l.status === 'New'),
      documents: documents.filter(d => d.status === 'missing' || d.status === 'Missing'),
      dscRecords,
      notices
    };

    const partnerName = keys.PARTNER_NAME || 'Partner';
    
    // Generate AI brief
    const brief = await morningBrief.generateBrief({ partnerName, ...allData });
    
    // Send to partner
    await telegramService.sendAlert(brief, 'normal');
    
    console.log(`⏰ Morning Brief generated and sent successfully.\n`);
  } catch (err) {
    console.error('❌ runMorningBrief error:', err.message);
    logError('Morning Brief Scheduler', 'run()', err.message);
  }
}

function start() {
  // 08:45 AM IST every day
  cron.schedule('45 8 * * *', runMorningBrief, {
    timezone: 'Asia/Kolkata',
  });
}

module.exports = {
  start,
  runMorningBrief,
};
