// ai/proposalGenerator.js
// Description: AI proposal generator module.
// CA Firm Automation Suite

const groqService = require('../services/groqService');
const keys = require('../config/keys');
const fs = require('fs');

async function generateProposal(params) {
    try {
        const systemPrompt = `You are an expert CA partner crafting a professional proposal for prospective clients. Generate a highly persuasive, detailed proposal text based on the provided firm and prospect details, proposed services, and fees. Do not use placeholders without filling them from context.`;
        
        const query = JSON.stringify(params);
        const response = await groqService.chat(systemPrompt, [], query);
        return response;
    } catch (error) {
        console.error("Error in generateProposal:", error);
        throw error;
    }
}

async function generateProposalPDF(proposalText, outputPath) {
    try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(outputPath);
        
        doc.pipe(stream);
        doc.fontSize(12).text(proposalText, { align: 'left' });
        doc.end();
        
        return new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
    } catch (error) {
        console.error("Error generating PDF. Is pdfkit installed?", error);
        throw error;
    }
}

module.exports = {
    generateProposal,
    generateProposalPDF
};
