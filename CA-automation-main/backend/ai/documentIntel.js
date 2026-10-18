// backend/ai/documentIntel.js
// Gemini Vision & Groq Document Classifier & Data Extractor
// CA Firm Automation Suite — Part 4.5 AI Prompt Bible

const geminiService = require('../services/geminiService');
const groqService = require('../services/groqService');
const { keys } = require('../config/keys');

const CLASSIFICATION_SYSTEM_PROMPT = `You are a document intelligence engine for an Indian CA firm.
Analyze the document text or image provided and return ONLY valid JSON. No explanation. No markdown code fences.

{
  "documentType": "bank_statement | gst_invoice | purchase_invoice | form_16 | form_26as | gstr_2b | itr_v | balance_sheet | profit_loss | tds_certificate | aadhaar | pan_card | rent_agreement | salary_slip | other",
  "documentPeriod": "month/year or financial year if visible, else null",
  "entityName": "name of individual or company on document, else null",
  "pan": "PAN number if visible, else null",
  "gstin": "GSTIN if visible, else null",
  "totalAmount": 0,
  "invoiceNumber": "invoice or document number, else null",
  "issuerName": "bank name, employer name, or issuing authority, else null",
  "confidence": "high | medium | low",
  "notes": "any important observation about document quality or data completeness"
}`;

/**
 * Classify a document using extracted text or OCR string
 * @param {string} textContent
 * @returns {Promise<Object>}
 */
async function classifyDocumentText(textContent) {
  try {
    const prompt = `Analyze this document content:\n\n${textContent.slice(0, 4000)}`;
    const raw = await groqService.complete(prompt, CLASSIFICATION_SYSTEM_PROMPT, {
      temperature: 0.1,
      maxTokens: 1024,
    });

    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('[DOC-INTEL] Fallback extraction:', err.message);

    // Heuristic fallback
    const t = textContent.toLowerCase();
    let docType = 'other';
    if (t.includes('gstr') || t.includes('goods and services tax')) docType = 'gst_invoice';
    else if (t.includes('form 16') || t.includes('certificate under section 203')) docType = 'form_16';
    else if (t.includes('26as') || t.includes('annual tax statement')) docType = 'form_26as';
    else if (t.includes('statement of account') || t.includes('bank') || t.includes('ifsc')) docType = 'bank_statement';
    else if (t.includes('itr-v') || t.includes('acknowledgement')) docType = 'itr_v';
    else if (t.includes('balance sheet')) docType = 'balance_sheet';

    const panMatch = textContent.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/);
    const gstMatch = textContent.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/);

    return {
      documentType: docType,
      documentPeriod: null,
      entityName: null,
      pan: panMatch ? panMatch[0] : null,
      gstin: gstMatch ? gstMatch[0] : null,
      totalAmount: null,
      invoiceNumber: null,
      issuerName: null,
      confidence: 'medium',
      notes: 'Heuristically classified via fallback rules.',
    };
  }
}

/**
 * Classify a document image via Gemini Vision (if configured)
 * @param {Buffer|string} imageBufferOrBase64
 * @param {string} mimeType
 */
async function classifyDocumentImage(imageBufferOrBase64, mimeType = 'image/jpeg') {
  if (geminiService && geminiService.isAvailable && geminiService.isAvailable()) {
    try {
      const result = await geminiService.analyzeImage(imageBufferOrBase64, CLASSIFICATION_SYSTEM_PROMPT, mimeType);
      const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn('[DOC-INTEL] Gemini vision call failed, falling back to text classifier:', e.message);
    }
  }

  return {
    documentType: 'other',
    documentPeriod: null,
    entityName: null,
    pan: null,
    gstin: null,
    totalAmount: null,
    confidence: 'low',
    notes: 'Gemini Vision not active. Text classification available.',
  };
}

module.exports = {
  classifyDocumentText,
  classifyDocumentImage,
};
