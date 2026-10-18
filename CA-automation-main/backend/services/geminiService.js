// services/geminiService.js
// Google Gemini 1.5 Flash Vision & Multimodal Client
// CA Firm Automation Suite

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { keys } = require('../config/keys');

let genAI = null;

function getGeminiClient() {
  if (!genAI && keys.GEMINI_API_KEY && !keys.GEMINI_API_KEY.includes('your_')) {
    genAI = new GoogleGenerativeAI(keys.GEMINI_API_KEY);
  }
  return genAI;
}

function getVisionModel() {
  const client = getGeminiClient();
  if (!client) return null;
  return client.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

module.exports = {
  getGeminiClient,
  getVisionModel,
};
