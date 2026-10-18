// utils/helpers.js
// Shared utility functions used across the app

/**
 * Generate a unique ID with a prefix
 * e.g. makeId('LOG') → 'LOG-1234567890-342'
 */
function makeId(prefix = 'ID') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * Clean a phone number to digits only
 * e.g. "+91 98765-43210" → "919876543210"
 */
function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Check if two phone numbers match
 * Handles country code differences (91xxxxxxxxxx vs xxxxxxxxxx)
 */
function phonesMatch(p1, p2) {
  const a = cleanPhone(p1);
  const b = cleanPhone(p2);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

/**
 * Calculate days difference between a date string and today
 * Returns positive = future, negative = overdue, 0 = today
 */
function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const MS_DAY = 24 * 60 * 60 * 1000;
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = new Date(todayStr + 'T00:00:00Z');
  const target = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / MS_DAY);
}

/**
 * Calculate days SINCE a past date (how many days ago)
 */
function daysSince(dateStr) {
  if (!dateStr) return null;
  const MS_DAY = 24 * 60 * 60 * 1000;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / MS_DAY);
}

/**
 * Format today's date as YYYY-MM-DD
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Add N days to today and return as YYYY-MM-DD
 */
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Truncate a string to max length
 */
function truncate(str, max = 900) {
  return String(str || '').slice(0, max);
}

/**
 * Safe JSON parse — returns fallback on error
 */
function safeJsonParse(str, fallback = {}) {
  try {
    const match = String(str).match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : str);
  } catch {
    return fallback;
  }
}

/**
 * Format current ISO timestamp
 */
function nowISO() {
  return new Date().toISOString();
}

module.exports = {
  makeId,
  cleanPhone,
  phonesMatch,
  daysFromToday,
  daysSince,
  todayISO,
  addDays,
  truncate,
  safeJsonParse,
  nowISO,
};
