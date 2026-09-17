// TL-raised inline remarks on a diet plan (see supabase/schema.sql's
// diet_remarks table) — a TL highlights one block of the rendered plan (a
// recipe card, a schedule-table row, an info-table row, a freeText line)
// and leaves a comment explaining what's wrong. The coach who owns that
// patient sees the highlight the next time they open that gear, reads the
// comment, and once it's fixed clicks "Mark Resolved".
//
// patient_name/health_coach_name/batch/condition_label are captured at RAISE
// time rather than joined live off the sheet: the "Diet Remarks" panel lists
// remarks across every patient/sheet, but only whichever ONE sheet is
// currently active is loaded client-side, so a live join would leave every
// remark from a different sheet showing blank names. A point-in-time
// snapshot is also arguably more correct here — it shows who the coach and
// batch were when the mistake was actually flagged.
const { supabaseAdmin } = require('./supabaseAdmin');

const STATUSES = new Set(['pending', 'resolved']);

function toApi(row) {
  return {
    id: row.id,
    personKey: row.person_key,
    gear: row.gear,
    remarkKey: row.remark_key,
    highlightedText: row.highlighted_text,
    comment: row.comment,
    patientName: row.patient_name,
    healthCoachName: row.health_coach_name,
    batch: row.batch,
    conditionLabel: row.condition_label,
    raisedByName: row.raised_by_name,
    raisedByEmail: row.raised_by_email,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name,
  };
}

// Every remark across every gear for one patient — what GearViewer fetches
// to know which blocks of the plan currently on screen need a highlight.
async function listRemarksForPatient(personKey) {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .select('*')
    .eq('person_key', personKey)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toApi);
}

// Every remark across every patient — the "Diet Remarks" sidebar panel.
async function listAllRemarks() {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toApi);
}

async function createRemark({
  personKey, gear, remarkKey, highlightedText, comment,
  patientName, healthCoachName, batch, conditionLabel, raisedBy,
}) {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .insert({
      person_key: personKey,
      gear,
      remark_key: remarkKey,
      highlighted_text: highlightedText,
      comment,
      patient_name: patientName || null,
      health_coach_name: healthCoachName || null,
      batch: batch || null,
      condition_label: conditionLabel || null,
      raised_by_id: raisedBy.id,
      raised_by_name: raisedBy.name,
      raised_by_email: raisedBy.email,
    })
    .select()
    .single();
  if (error) throw error;
  return toApi(data);
}

// Open to any signed-in staff member (not TL-only) — fired automatically
// when a coach edits or replaces a recipe that currently carries a pending
// remark (see client/src/components/GearViewer.jsx's maybeRekeyRemark), so
// the remark's badge/highlight follows the slot onto its new content instead
// of silently going stale. Guarded to status='pending' for the same reason
// resolveRemark is: never touch a remark that's already been resolved.
async function rekeyRemark(id, newRemarkKey) {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .update({ remark_key: newRemarkKey })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Remark not found or already resolved');
  return toApi(data);
}

async function resolveRemark(id, resolvedByName) {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_name: resolvedByName })
    .eq('id', id)
    .eq('status', 'pending') // resolving twice shouldn't overwrite the first resolved_at/by
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Remark not found or already resolved');
  return toApi(data);
}

// Lets the TL who raised one take it back (mis-flagged, or the comment was
// wrong) without it ever counting as the coach's own "resolved" action.
async function deleteRemark(id, raisedById) {
  const { data, error } = await supabaseAdmin
    .from('diet_remarks')
    .delete()
    .eq('id', id)
    .eq('raised_by_id', raisedById)
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Remark not found, or you did not raise it');
  return toApi(data);
}

module.exports = { listRemarksForPatient, listAllRemarks, createRemark, resolveRemark, rekeyRemark, deleteRemark, STATUSES };
