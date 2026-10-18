// config/keys.js
// Central validated configuration loader for CA Firm Automation Suite

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const keys = Object.freeze({
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // JWT Authentication
  JWT_SECRET: process.env.JWT_SECRET || 'ca_firm_jwt_secret_change_me_in_production_2026',

  // Firm Branding
  FIRM_NAME: process.env.FIRM_NAME || 'Sharma & Associates',
  FIRM_CITY: process.env.FIRM_CITY || 'Mumbai',
  FIRM_PHONE: process.env.FIRM_PHONE || '+919876543210',
  FIRM_EMAIL: process.env.FIRM_EMAIL || 'info@sharmaassociates.in',
  PARTNER_NAME: process.env.PARTNER_NAME || 'Managing Partner',

  // Razorpay Payment Gateway
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,

  // Google Sheets Database
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null,

  // Groq AI (LPU Inference)
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL_PRIMARY: process.env.GROQ_MODEL_PRIMARY || 'openai/gpt-oss-120b',
  GROQ_MODEL_FAST: process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b',
  GROQ_MODEL: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',

  // Google Gemini Vision (OCR)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // Meta WhatsApp Cloud API
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'ca_suite_verify_2026',
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,

  // Email (Gmail SMTP / Nodemailer)
  EMAIL_FROM: process.env.EMAIL_FROM || process.env.EMAIL_USER,
  EMAIL_APP_PASSWORD: process.env.EMAIL_APP_PASSWORD,
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'Sharma & Associates',

  // Telegram Alert Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_PARTNER_CHAT_ID: process.env.TELEGRAM_PARTNER_CHAT_ID,

  // Cloudflare R2 Document Vault
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'ca-firm-documents',
  R2_ENDPOINT: process.env.R2_ENDPOINT,
});

/**
 * Diagnostic check called during server boot
 */
function checkKeys() {
  const isPlaceholder = (val) => !val || String(val).includes('your_') || String(val).includes('xxxx');

  const critical = [
    { name: 'GOOGLE_SHEET_ID', val: keys.GOOGLE_SHEET_ID },
    { name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', val: keys.GOOGLE_SERVICE_ACCOUNT_EMAIL },
    { name: 'GOOGLE_PRIVATE_KEY', val: keys.GOOGLE_PRIVATE_KEY },
    { name: 'GROQ_API_KEY', val: keys.GROQ_API_KEY },
  ];

  const optional = [
    { service: 'Google Gemini 1.5 OCR', ok: !isPlaceholder(keys.GEMINI_API_KEY) },
    { service: 'WhatsApp Cloud API', ok: !isPlaceholder(keys.WHATSAPP_ACCESS_TOKEN) && !isPlaceholder(keys.WHATSAPP_PHONE_NUMBER_ID) },
    { service: 'Email (Gmail SMTP)', ok: !isPlaceholder(keys.EMAIL_FROM) && !isPlaceholder(keys.EMAIL_APP_PASSWORD) },
    { service: 'Telegram Partner Bot', ok: !isPlaceholder(keys.TELEGRAM_BOT_TOKEN) && !isPlaceholder(keys.TELEGRAM_PARTNER_CHAT_ID) },
    { service: 'Cloudflare R2 Vault', ok: !isPlaceholder(keys.R2_ACCESS_KEY_ID) && !isPlaceholder(keys.R2_SECRET_ACCESS_KEY) },
  ];

  const missingCritical = critical.filter((c) => isPlaceholder(c.val));
  if (missingCritical.length > 0) {
    console.warn('\n⚠️  Missing critical configuration:');
    missingCritical.forEach((c) => console.warn(`   → ${c.name}`));
    console.warn('   Fill these in backend/.env for database and core AI functions.\n');
  } else {
    console.log('✅ Core Database & AI credentials loaded successfully');
  }

  console.log('\n📡 Integration Channels Status:');
  optional.forEach((opt) => {
    console.log(`   ${opt.ok ? '🟢' : '⚪'} ${opt.service.padEnd(25)}: ${opt.ok ? 'Active' : 'Not configured (Simulated/Fallback)'}`);
  });
  console.log('');
}

module.exports = { keys, checkKeys };
