// Backs the developer-only "Team" page: lists every signed-up account and
// lets a developer change someone's role (e.g. promote them to 'tl') — the
// only way a 'tl' account gets created, since signup itself always defaults
// to 'employee' (see supabase/schema.sql's handle_new_user trigger).
const { supabaseAdmin } = require('./supabaseAdmin');

async function listTeam() {
  const { data, error } = await supabaseAdmin
    .from('diet_tracker')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function setRole(id, role) {
  const { data, error } = await supabaseAdmin
    .from('diet_tracker')
    .update({ role })
    .eq('id', id)
    .select('id, email, full_name, role')
    .single();
  if (error) throw error;
  return data;
}

module.exports = { listTeam, setRole };
