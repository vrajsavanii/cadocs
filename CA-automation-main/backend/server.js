// server.js — Main Express Server & Schedulers Orchestrator
// CA Firm Automation Suite — v2.0 with JWT Auth, RBAC, Phase 1 Features

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { keys, checkKeys } = require('./config/keys');
const { expressErrorMiddleware } = require('./utils/errorHandler');

// ── API ROUTERS ───────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const clientRoutes    = require('./routes/clientRoutes');
const leadRoutes      = require('./routes/leadRoutes');
const complianceRoutes = require('./routes/complianceRoutes');
const documentRoutes  = require('./routes/documentRoutes');
const invoiceRoutes   = require('./routes/invoiceRoutes');
const aiRoutes        = require('./routes/aiRoutes');

// ── PHASE 1 ROUTERS ───────────────────────────────────────────────────────────
const udinRoutes     = tryRequire('./routes/udinRoutes');
const dscRoutes      = tryRequire('./routes/dscRoutes');
const noticeRoutes   = tryRequire('./routes/noticeRoutes');
const blastRoutes    = tryRequire('./routes/blastRoutes');
const proposalRoutes = tryRequire('./routes/proposalRoutes');
const timesheetRoutes = tryRequire('./routes/timesheetRoutes');

// ── WEBHOOK ROUTERS ───────────────────────────────────────────────────────────
const whatsappWebhook       = require('./webhooks/whatsappWebhook');
const websiteLeadWebhook    = require('./webhooks/websiteLeadWebhook');
const paymentWebhook        = require('./webhooks/paymentWebhook');
const documentRequestWebhook = require('./webhooks/documentRequestWebhook');

// ── SCHEDULERS ───────────────────────────────────────────────────────────────
const complianceReminder = require('./schedulers/complianceReminder');
const documentFollowup   = require('./schedulers/documentFollowup');
const leadFollowup       = require('./schedulers/leadFollowup');
const invoiceFollowup    = require('./schedulers/invoiceFollowup');

// Phase 1 schedulers (graceful — only start if file exists)
const dscExpiryAlert       = tryRequire('./schedulers/dscExpiryAlert');
const noticeDeadlineAlert  = tryRequire('./schedulers/noticeDeadlineAlert');
const morningBriefScheduler = tryRequire('./schedulers/morningBriefScheduler');

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
const { requireAuth } = require('./middleware/auth');

// Helper: gracefully require optional modules
function tryRequire(modulePath) {
  try { return require(modulePath); }
  catch { return null; }
}

// ── APP SETUP ─────────────────────────────────────────────────────────────────
const app = express();

// CORS policy — allow configured frontend and localhost tools
app.use(cors({
  origin: [
    keys.FRONTEND_URL,
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://localhost:3000',
    'null',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token'],
  credentials: true,
}));

// Body parsers (JSON + URL-encoded)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Serve static assets — uploads directory (proposal PDFs etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { dotfiles: 'deny' }));

// Redirect /login directly to dashboard (credentials removed)
app.get('/login', (req, res) => {
  res.redirect('/');
});

// Serve static frontend assets from workspace root
const workspaceRoot = path.join(__dirname, '..');
app.use(express.static(workspaceRoot, {
  index: false,
  dotfiles: 'deny',
  extensions: ['html', 'js', 'css', 'png', 'jpg', 'svg', 'ico', 'woff2'],
}));

// ── PUBLIC ROUTES (no auth required) ─────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '✅ CA Firm Automation API is running',
    firm: keys.FIRM_NAME,
    version: '2.0.0',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    authEnabled: false,
  });
});

// ── AUTH ROUTES (public — no JWT required) ────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── DASHBOARD ROUTE (protected) ───────────────────────────────────────────────
// Frontend sends JWT via header; if missing, redirect to login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../HTML text.html'));
});

// ── PROTECTED API ROUTES ──────────────────────────────────────────────────────
// All /api/* routes below require authentication
app.use('/api', requireAuth);

app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/clients',    clientRoutes);
app.use('/api/leads',      leadRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/documents',  documentRoutes);
app.use('/api/invoices',   invoiceRoutes);
app.use('/api/ai',         aiRoutes);

// Phase 1 routes (mounted only if files exist)
if (udinRoutes)     app.use('/api/udin',      udinRoutes);
if (dscRoutes)      app.use('/api/dsc',        dscRoutes);
if (noticeRoutes)   app.use('/api/notices',    noticeRoutes);
if (blastRoutes)    app.use('/api/blast',      blastRoutes);
if (proposalRoutes) app.use('/api/proposals',  proposalRoutes);
if (timesheetRoutes) app.use('/api/timesheets', timesheetRoutes);

// ── WEBHOOK ROUTES (NOT protected by JWT — use secret token verification) ─────
app.use('/webhook/whatsapp',           whatsappWebhook);
app.use('/webhook/website-lead',       websiteLeadWebhook);
app.use('/webhook/payment',            paymentWebhook);
app.use('/webhook/request-documents',  documentRequestWebhook);

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
app.use(expressErrorMiddleware);

// ── START SERVER ──────────────────────────────────────────────────────────────
const server = app.listen(keys.PORT, () => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 ${keys.FIRM_NAME} — Practice Automation Suite v2.0`);
  console.log(`   URL:      http://localhost:${keys.PORT}`);
  console.log(`   Env:      ${keys.NODE_ENV}`);
  console.log(`   Auth:     JWT + RBAC (4 roles)`);
  console.log(`   Timezone: Asia/Kolkata (IST)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  checkKeys();

  // Initialize core daily schedulers (IST)
  complianceReminder.start();
  documentFollowup.start();
  leadFollowup.start();
  invoiceFollowup.start();

  // Initialize Phase 1 schedulers if available
  if (dscExpiryAlert)       dscExpiryAlert.start();
  if (noticeDeadlineAlert)  noticeDeadlineAlert.start();
  if (morningBriefScheduler) morningBriefScheduler.start();

  console.log('⏰ Active Daily Schedulers (Asia/Kolkata):');
  console.log('   08:00 AM IST — DSC Expiry Alerts');
  console.log('   08:45 AM IST — Morning Intelligence Brief (Telegram)');
  console.log('   09:00 AM IST — Statutory Compliance & Penalty Reminders');
  console.log('   09:15 AM IST — Notice Response Deadline Alerts');
  console.log('   09:30 AM IST — Client Document Follow-ups');
  console.log('   10:00 AM IST — Inbound Lead Proposal Follow-ups');
  console.log('   10:30 AM IST — Fee Recovery & Invoice Reminders\n');
});

module.exports = app;
