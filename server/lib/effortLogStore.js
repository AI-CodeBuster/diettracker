// Backs the "Effort Goal" dashboard section and the on-time half of the
// Prep %/Verification % report — records who prepared or verified a gear,
// and when, since neither is captured anywhere else (see supabase/schema.sql).
const { supabaseAdmin } = require('./supabaseAdmin');

const ACTIONS = new Set(['prepared', 'verified']);

async function logEffort({ personKey, gear, action, performedById, performedByName }) {
  if (!ACTIONS.has(action)) throw new Error(`Invalid effort action: ${action}`);
  const { error } = await supabaseAdmin.from('diet_effort_log').insert({
    person_key: personKey,
    gear: Number(gear),
    action,
    performed_by_id: performedById || null,
    performed_by_name: performedByName || null,
  });
  if (error) throw error;
}

// One row per (person_key, gear) the most recent "prepared" entry for it —
// used to check whether a prep happened before its Due Date ("on time"),
// since the sheet itself never records when the prep actually happened.
async function latestPreparedAt() {
  const { data, error } = await supabaseAdmin
    .from('diet_effort_log')
    .select('person_key, gear, performed_at')
    .eq('action', 'prepared')
    .order('performed_at', { ascending: false });
  if (error) throw error;
  const map = new Map(); // `${personKey}:${gear}` -> ISO timestamp (first seen = most recent, since ordered desc)
  (data || []).forEach((row) => {
    const key = `${row.person_key}:${row.gear}`;
    if (!map.has(key)) map.set(key, row.performed_at);
  });
  return map;
}

// Today's per-person counts (server's local day, matching how a Team
// Member/TL would think of "today"), split by action — feeds the Effort
// Goal dashboard's actual-vs-target tiles.
async function todaysCountsByPerson() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin
    .from('diet_effort_log')
    .select('action, performed_by_name')
    .gte('performed_at', startOfDay.toISOString());
  if (error) throw error;
  const counts = {}; // name -> { prepared, verified }
  (data || []).forEach((row) => {
    const name = row.performed_by_name || 'Unknown';
    if (!counts[name]) counts[name] = { prepared: 0, verified: 0 };
    counts[name][row.action] += 1;
  });
  return counts;
}

module.exports = { logEffort, latestPreparedAt, todaysCountsByPerson, ACTIONS };
