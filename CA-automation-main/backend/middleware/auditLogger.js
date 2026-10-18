// backend/middleware/auditLogger.js
// Append-Only Audit Trail — logs every write operation to Google Sheets Audit_Log tab
// CA Firm Automation Suite

const sheetsService = require('../services/sheetsService');

const AUDIT_TAB = 'Audit_Log';

/**
 * logAudit — call before every CREATE / UPDATE / DELETE operation
 * @param {Object} params
 * @param {string} params.userId - who performed the action (req.user.id or 'system')
 * @param {string} params.userName - display name
 * @param {string} params.action - 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'SEND_MESSAGE'
 * @param {string} params.entityType - 'client' | 'invoice' | 'compliance' | 'document' | 'lead'
 * @param {string} params.entityId - the ID of the affected record
 * @param {Object} [params.oldValue] - previous values (for updates)
 * @param {Object} [params.newValue] - new values
 * @param {string} [params.ipAddress] - request IP
 * @param {string} [params.notes] - any extra context
 */
async function logAudit({ userId, userName, action, entityType, entityId, oldValue, newValue, ipAddress, notes }) {
  try {
    const row = {
      log_id: `LOG-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_id: userId || 'system',
      user_name: userName || 'System',
      action: action || 'UNKNOWN',
      entity_type: entityType || '',
      entity_id: String(entityId || ''),
      old_value: oldValue ? JSON.stringify(oldValue) : '',
      new_value: newValue ? JSON.stringify(newValue) : '',
      ip_address: ipAddress || '',
      notes: notes || '',
    };

    // Fire and forget — don't block the main response
    sheetsService.appendRow(AUDIT_TAB, row).catch(err => {
      console.warn('[AUDIT] Failed to write audit log:', err.message);
    });
  } catch (err) {
    console.warn('[AUDIT] logAudit error:', err.message);
  }
}

/**
 * Express middleware factory that auto-logs writes.
 * Usage: router.post('/clients', requireAuth, auditMiddleware('CREATE', 'client'), handler)
 */
function auditMiddleware(action, entityType) {
  return (req, res, next) => {
    // Patch res.json to intercept successful responses and log after them
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        logAudit({
          userId: req.user.id,
          userName: req.user.name,
          action,
          entityType,
          entityId: data?.client?.client_id || data?.invoice?.invoice_id || req.params?.clientId || req.params?.invoiceId || '',
          newValue: req.body || {},
          ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
        });
      }
      return originalJson(data);
    };
    next();
  };
}

module.exports = { logAudit, auditMiddleware };
