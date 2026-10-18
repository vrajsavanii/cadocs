// ai/penaltyExplainer.js
// Description: AI penalty calculator and explainer.
// CA Firm Automation Suite

const groqService = require('../services/groqService');
const keys = require('../config/keys');

async function explainPenalty({ complianceType, dueDate, filingDate, entityType, turnover, taxLiability, state }) {
    try {
        const systemPrompt = `You are an expert in Indian tax penalties. Explain the penalty for the given parameters and respond in strictly valid JSON format matching this structure:
{
  "lateDays": 0,
  "penaltyBreakdown": { "lateFee": "", "interest": "", "maximumLateFee": "" },
  "totalPenalty": "",
  "statutoryReference": "",
  "waiverAvailable": false,
  "waiverNote": null,
  "urgencyLevel": "low|medium|high",
  "recommendedAction": ""
}`;
        
        const query = `Compliance: ${complianceType}, Due: ${dueDate}, Filed: ${filingDate}, Entity: ${entityType}, Turnover: ${turnover}, Tax: ${taxLiability}, State: ${state}`;
        
        const raw = await groqService.complete(query, systemPrompt);
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(cleaned);
    } catch (error) {
        console.error("Error in penaltyExplainer, using fallback:", error);
        
        // Basic fallback for GST
        const due = new Date(dueDate);
        const filed = new Date(filingDate);
        const lateDays = Math.max(0, Math.floor((filed - due) / (1000 * 60 * 60 * 24)));
        const lateFee = lateDays * 100; // Rs 100 per day for GST (example)

        return {
            lateDays: lateDays,
            penaltyBreakdown: { lateFee: `₹${lateFee}`, interest: "0", maximumLateFee: "N/A" },
            totalPenalty: `₹${lateFee}`,
            statutoryReference: "Section 47 of CGST Act",
            waiverAvailable: false,
            waiverNote: null,
            urgencyLevel: lateDays > 30 ? "high" : (lateDays > 0 ? "medium" : "low"),
            recommendedAction: "File immediately and pay late fee."
        };
    }
}

module.exports = {
    explainPenalty
};
