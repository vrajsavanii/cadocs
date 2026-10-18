// utils/errorHandler.js
// Global error logger — logs to Error_Log sheet + Telegram alert

const { ErrorLog } = require('../services/sheetsService');
const { sendAlert } = require('../services/telegramService');
const { makeId, truncate, nowISO } = require('./helpers');

async function logError(workflowName, nodeName, errorMessage) {
  const entry = {
    error_id: makeId('ERR'),
    workflow_name: workflowName || 'CA Firm Automation',
    node_name: nodeName || 'unknown',
    error_message: truncate(String(errorMessage), 900),
    timestamp: nowISO(),
  };

  // Log to sheet
  await ErrorLog.append(entry);

  // Alert partner on Telegram
  await sendAlert(
    `⚠️ *CA Firm Automation Error*\nWorkflow: ${entry.workflow_name}\nNode: ${entry.node_name}\nError: ${entry.error_message}\nTime: ${entry.timestamp}`
  );

  console.error(`🚨 Error logged [${entry.error_id}]:`, errorMessage);
}

// Express global error middleware
function expressErrorMiddleware(err, req, res, next) {
  logError('Express API', req.path, err.message);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong. Team notified.' });
}

module.exports = { logError, expressErrorMiddleware };
