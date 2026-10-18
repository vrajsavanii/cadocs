// ai/complianceTaskGen.js
// Description: Auto-generates compliance tasks based on client profile.
// CA Firm Automation Suite

const groqService = require('../services/groqService');
const keys = require('../config/keys');

function getDefaultTasks(profile) {
    const tasks = [];
    
    if (profile.hasGST) {
        tasks.push({
            taskName: "File GSTR-3B",
            frequency: "Monthly",
            complianceType: "GST",
            dueDateDetails: "20th of next month"
        });
    }
    
    if (profile.hasTDS) {
        tasks.push({
            taskName: "File TDS 26Q",
            frequency: "Quarterly",
            complianceType: "TDS",
            dueDateDetails: "End of month following quarter"
        });
    }
    
    if (profile.hasIncomeTax) {
        tasks.push({
            taskName: `File ITR (${profile.itrForm || 'Appropriate Form'})`,
            frequency: "Annually",
            complianceType: "Income Tax",
            dueDateDetails: profile.requiresAudit ? "31st October" : "31st July"
        });
    }
    
    return tasks;
}

async function generateTasksForClient(profile) {
    try {
        const systemPrompt = `You are a compliance mapping assistant. Based on the client profile, generate a comprehensive list of compliance tasks they must fulfill for the year. Respond strictly as a JSON array of task objects, each containing: taskName, frequency, complianceType, and dueDateDetails.`;
        
        const query = JSON.stringify(profile);
        
        if (groqService.classifyToJSON) {
            return await groqService.classifyToJSON(query, systemPrompt);
        } else {
            const response = await groqService.chat(query, systemPrompt);
            return JSON.parse(response);
        }
    } catch (error) {
        console.error("Error in generateTasksForClient, using static fallback:", error);
        return getDefaultTasks(profile);
    }
}

module.exports = {
    generateTasksForClient,
    getDefaultTasks
};
