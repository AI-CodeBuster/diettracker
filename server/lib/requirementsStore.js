// Feature/product requirements raised from the app's own "Requirements"
// section, backed by the diet_requirements Supabase table (see
// supabase/schema.sql). A separate backlog from diet_issues (see
// issuesStore.js) — bugs are things that broke, requirements are things to
// build — but the same shape.
const { supabaseAdmin } = require('./supabaseAdmin');

const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set(['proposed', 'in_progress', 'done', 'declined']);

function toApi(row) {
  return {
    id: row.id,
    code: row.code,
    priority: row.priority,
    title: row.title,
    area: row.area,
    description: row.description,
    status: row.status,
    requestedByName: row.requested_by_name,
    requestedByEmail: row.requested_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRequirements() {
  const { data, error } = await supabaseAdmin
    .from('diet_requirements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toApi);
}

async function createRequirement({ priority, title, area, description, requestedBy }) {
  const { data, error } = await supabaseAdmin
    .from('diet_requirements')
    .insert({
      priority: priority || 'medium',
      title,
      area: area || null,
      description: description || null,
      requested_by_id: requestedBy.id,
      requested_by_name: requestedBy.name,
      requested_by_email: requestedBy.email,
    })
    .select()
    .single();
  if (error) throw error;
  return toApi(data);
}

async function updateRequirementStatus(id, status) {
  if (!STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  const { data, error } = await supabaseAdmin
    .from('diet_requirements')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Requirement not found');
  return toApi(data);
}

module.exports = { listRequirements, createRequirement, updateRequirementStatus, PRIORITIES, STATUSES };
