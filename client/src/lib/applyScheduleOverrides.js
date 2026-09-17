// Splices a patient's saved Diet Schedule cell edits into one gear's
// diet-template data before it's rendered — the schedule-editing sibling of
// applyRecipeOverrides.js, same "fetch fresh, apply on top" pattern (the
// shared template file itself, server/diet-data/*.json, is never mutated;
// every patient on that same condition/gear/dietType/language combination
// keeps getting served the identical file, with each patient's own edits
// layered on afterward from server/lib/scheduleOverrideStore.js).
//
// Unlike a recipe override (keyed by recipe_id, a real content identity), a
// schedule row has no identity of its own to key against — an edit is keyed
// purely by POSITION: which table, which row, which column, at the time the
// coach made the edit. mealPlanTableKey/infoTableKey are the single source
// of truth for that table-identifying half of the key — DietTemplateView.jsx
// imports them too, so a cell always computes the exact same key this file
// expects to find it under.
function mealPlanTableKey(title) {
  return `mealplan:${title}`;
}

function infoTableKey(title) {
  return `infotable:${title || 'table'}`;
}

// overrides: [{ tableKey, rowIndex, colIndex, value }] — colIndex 0 is the
// day column for a MealPlanTable row (day/cells split), or plainly column 0
// of an InfoTable row (a flat string array, no day column at all).
function applyScheduleOverrides(data, overrides) {
  if (!overrides || !overrides.length) return data;
  const byTable = new Map();
  for (const o of overrides) {
    if (!byTable.has(o.tableKey)) byTable.set(o.tableKey, []);
    byTable.get(o.tableKey).push(o);
  }
  if (!byTable.size) return data;

  const mealPlans = (data.mealPlans || []).map((plan) => {
    const edits = byTable.get(mealPlanTableKey(plan.title));
    if (!edits || !edits.length) return plan;
    const rows = plan.rows.map((row, i) => {
      const rowEdits = edits.filter((e) => e.rowIndex === i);
      if (!rowEdits.length) return row;
      let day = row.day;
      const cells = [...row.cells];
      for (const e of rowEdits) {
        if (e.colIndex === 0) day = e.value;
        else cells[e.colIndex - 1] = e.value;
      }
      return { ...row, day, cells };
    });
    return { ...plan, rows };
  });

  const infoTables = (data.infoTables || []).map((table) => {
    const edits = byTable.get(infoTableKey(table.title));
    if (!edits || !edits.length) return table;
    const rows = table.rows.map((row, i) => {
      const rowEdits = edits.filter((e) => e.rowIndex === i);
      if (!rowEdits.length) return row;
      const next = [...row];
      for (const e of rowEdits) next[e.colIndex] = e.value;
      return next;
    });
    return { ...table, rows };
  });

  return { ...data, mealPlans, infoTables };
}

export { applyScheduleOverrides, mealPlanTableKey, infoTableKey };
