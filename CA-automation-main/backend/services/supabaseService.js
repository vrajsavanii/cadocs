// backend/services/supabaseService.js
// PostgreSQL / Supabase Client Adapter
// CA Firm Automation Suite

const { keys } = require('../config/keys');

let supabase = null;

// Only initialize if Supabase URL and Key are provided in environment
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    console.log('✅ Supabase PostgreSQL client connected');
  } catch (err) {
    console.warn('⚠️ Supabase package not installed or credentials invalid:', err.message);
  }
}

function isConfigured() {
  return supabase !== null;
}

/**
 * Generic query helper
 */
async function query(table, filter = {}) {
  if (!supabase) return null;
  let builder = supabase.from(table).select('*');
  for (const [key, val] of Object.entries(filter)) {
    builder = builder.eq(key, val);
  }
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

/**
 * Insert record helper
 */
async function insert(table, row) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

/**
 * Update record helper
 */
async function update(table, idColumn, idVal, updates) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).update(updates).eq(idColumn, idVal).select().single();
  if (error) throw error;
  return data;
}

module.exports = {
  getClient: () => supabase,
  isConfigured,
  query,
  insert,
  update,
};
