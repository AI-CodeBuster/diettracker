// diet_tracker.role gates who can act on raised bugs/enhancements/requirements
// (see supabase/schema.sql — developer@gmail.com is seeded as 'developer' at
// signup, everyone else starts as a plain 'employee'; a developer can
// promote someone to 'tl' via /api/team, see server/lib/teamStore.js).
const { supabaseAdmin } = require('./supabaseAdmin');

async function getUserRole(userId) {
  const { data, error } = await supabaseAdmin.from('diet_tracker').select('role').eq('id', userId).single();
  if (error || !data) return null;
  return data.role;
}

// Only a developer can move a ticket through its status pipeline (start
// fixing it, mark it done, reject it) — everyone else can raise/view but not
// resolve, so the queue can't be quietly marked away by whoever hit it first.
async function requireDeveloper(req, res, next) {
  try {
    const role = await getUserRole(req.user.id);
    if (role !== 'developer') return res.status(403).json({ error: 'Only the developer account can update status' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Could not verify permissions' });
  }
}

// TL verification/remarks are gated to the 'tl' role — 'developer' can do
// anything a 'tl' can (same superuser convention as the rest of this file),
// so testing the flow doesn't require a second real account.
async function requireTL(req, res, next) {
  try {
    const role = await getUserRole(req.user.id);
    if (role !== 'tl' && role !== 'developer') return res.status(403).json({ error: 'Only a TL account can verify diet plans' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Could not verify permissions' });
  }
}

module.exports = { getUserRole, requireDeveloper, requireTL };
