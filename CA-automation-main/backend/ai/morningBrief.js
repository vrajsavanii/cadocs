// ai/morningBrief.js
// Description: Generates morning briefing for Telegram.
// CA Firm Automation Suite

const groqService = require('../services/groqService');
const keys = require('../config/keys');

async function generateBrief(params) {
    const { partnerName, urgentCompliance, upcomingCompliance, missingDocClients, overdueInvoices, newLeads, expiringDSC, noticeDeadlines, todayIST, dayOfWeek } = params;
    
    try {
        const systemPrompt = `You are the CA firm's automated assistant. Generate a highly readable, concise, and structured daily morning briefing for Telegram based on the provided data. Greet the partner and list urgent compliances, upcoming deadlines, missing docs, overdue invoices, and DSCs expiring. Use emojis to make it readable. Keep it professional.`;
        
        const query = JSON.stringify(params);
        
        const response = await groqService.chat(query, systemPrompt);
        return response;
    } catch (error) {
        console.error("Error in morningBrief AI, using fallback:", error);
        return `*Morning Brief for ${partnerName}* ☀️\nDate: ${todayIST} (${dayOfWeek})\n\n🚨 *Urgent Compliances:*\n${urgentCompliance || 'None'}\n\n📅 *Upcoming Deadlines:*\n${upcomingCompliance || 'None'}\n\n📄 *Missing Docs:*\n${missingDocClients || 'None'}\n\n💰 *Overdue Invoices:*\n${overdueInvoices || 'None'}\n\n🔐 *Expiring DSCs:*\n${expiringDSC || 'None'}\n\n⚖️ *Notice Deadlines:*\n${noticeDeadlines || 'None'}\n\n🎯 *New Leads:*\n${newLeads || 'None'}`;
    }
}

module.exports = {
    generateBrief
};
