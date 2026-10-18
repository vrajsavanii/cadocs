// services/emailService.js
// Send emails via Gmail + Nodemailer (App Password method - no OAuth needed)

const nodemailer = require('nodemailer');
const { keys } = require('../config/keys');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: keys.EMAIL_FROM,
        pass: keys.EMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

// ── SEND EMAIL ───────────────────────────────────────────────────────────────
async function sendEmail(toEmail, subject, body, retries = 3) {
  if (!toEmail || !toEmail.includes('@')) {
    console.warn('⚠️ emailService: invalid or missing email, skipping');
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await getTransporter().sendMail({
        from: `"${keys.FIRM_NAME}" <${keys.EMAIL_FROM}>`,
        to: toEmail,
        subject,
        text: body,
      });
      console.log(`✅ Email sent to ${toEmail}`);
      return true;
    } catch (err) {
      console.error(`❌ Email attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt < retries) await sleep(4000);
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sendEmail };
