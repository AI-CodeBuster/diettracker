// Bugs & enhancements raised from the app's own "Bugs & Enhancements"
// section, backed by the diet_issues Supabase table (see supabase/schema.sql).
const { supabaseAdmin } = require('./supabaseAdmin');

const KINDS = new Set(['bug', 'enhancement']);
const URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set(['open', 'in_progress', 'fixed', 'wont_do']);

function toApi(row) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    urgency: row.urgency,
    title: row.title,
    screen: row.screen,
    whatHappened: row.what_happened,
    reproSteps: row.repro_steps,
    status: row.status,
    raisedByName: row.raised_by_name,
    raisedByEmail: row.raised_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listIssues() {
  const { data, error } = await supabaseAdmin
    .from('diet_issues')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toApi);
}

async function createIssue({ kind, urgency, title, screen, whatHappened, reproSteps, raisedBy }) {
  const { data, error } = await supabaseAdmin
    .from('diet_issues')
    .insert({
      kind,
      urgency: urgency || 'medium',
      title,
      screen: screen || null,
      what_happened: whatHappened || null,
      repro_steps: reproSteps || null,
      raised_by_id: raisedBy.id,
      raised_by_name: raisedBy.name,
      raised_by_email: raisedBy.email,
    })
    .select()
    .single();
  if (error) throw error;
  return toApi(data);
}

async function updateIssueStatus(id, status) {
  if (!STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  const { data, error } = await supabaseAdmin
    .from('diet_issues')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Issue not found');
  return toApi(data);
}

module.exports = { listIssues, createIssue, updateIssueStatus, KINDS, URGENCIES, STATUSES };
