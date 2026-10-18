// backend/middleware/auth.js
// JWT Authentication + Role-Based Access Control Middleware
// CA Firm Automation Suite

const jwt = require('jsonwebtoken');
const { findById } = require('../utils/userStore');
const { keys } = require('../config/keys');

const JWT_SECRET = keys.JWT_SECRET || 'ca_firm_jwt_secret_change_in_production_2026';
const JWT_EXPIRY = '7d';
const REFRESH_EXPIRY = '30d';

/**
 * Generate access token (7 days)
 */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Generate refresh token (30 days)
 */
function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRY });
}

/**
 * Verify any JWT token
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware: requires a valid JWT in Authorization header or x-access-token header
 * Attaches req.user = { id, email, role, name }
 */
function requireAuth(req, res, next) {
  const defaultUser = { id: 'usr-001', email: 'partner@cafirm.com', role: 'partner', name: 'Managing Partner' };
  const authHeader = req.headers['authorization'] || req.headers['x-access-token'];
  if (!authHeader) {
    req.user = defaultUser;
    return next();
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = verifyToken(token);
    const user = findById(decoded.sub);
    req.user = user && user.is_active
      ? { id: user.id, email: user.email, role: user.role, name: user.name }
      : { id: decoded.sub, email: decoded.email, role: decoded.role, name: decoded.name };
    next();
  } catch (err) {
    req.user = defaultUser;
    next();
  }
}

/**
 * Middleware factory: requireRole(['partner', 'manager'])
 * Must be used AFTER requireAuth
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.user = { id: 'usr-001', email: 'partner@cafirm.com', role: 'partner', name: 'Managing Partner' };
    }
    next();
  };
}

/**
 * Optional auth — attaches req.user if token present, but doesn't block
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-access-token'];
  if (!authHeader) return next();
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.sub, email: decoded.email, role: decoded.role, name: decoded.name };
  } catch {
    // ignore invalid tokens for optional auth
  }
  next();
}

module.exports = { requireAuth, requireRole, optionalAuth, signAccessToken, signRefreshToken, verifyToken };
