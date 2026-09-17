// Generic normalizer: turns raw CSV header+rows from any of the tracker sheets
// (which have inconsistent but overlapping column layouts) into a common
// per-person shape the frontend can rely on regardless of which tab it's viewing.
const { parseCSV } = require('./csv');
const { normHeader, findIndex, findAllExact, zipToGearBlocks } = require('./sheetColumns');

function cell(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return (row[idx] || '').trim();
}

// The tracker sheets repeat the same sub-column names (Diet type, Drive
// Link, Due Date, TL Remarks...) once per gear block (GEAR4/GEAR3/GEAR2/...).
// Deduping them here — and using this exact list everywhere a header is
// needed (raw-object keys, CSV export, generic table) — keeps every column
// addressable instead of later ones silently overwriting earlier ones.
function dedupeHeaders(headers) {
  const seen = {};
  return headers.map((h, idx) => {
    let key = (h || '').replace(/\s+/g, ' ').trim();
    if (!key) key = `Column ${idx + 1}`;
    seen[key] = (seen[key] || 0) + 1;
    return seen[key] > 1 ? `${key} (${seen[key]})` : key;
  });
}

function classifyVeg(text) {
  const t = text.toLowerCase();
  if (/egg/.test(t)) return 'EGG';
  if (/non[\s-]?veg/.test(t)) return 'NONVEG';
  if (/\bveg/.test(t)) return 'VEG';
  return null;
}

function classifyLanguage(text) {
  const t = text.toLowerCase();
  if (/tam/.test(t)) return 'TAM';
  if (/eng/.test(t)) return 'ENG';
  return null;
}

// Only 'done' clears a gear's blood-report checkpoint; every other value
// gates it. A blank cell and an explicit "NA"/"N/A" both mean the report
// isn't there, so both report 'not_provided' — coaches type "NA" into this
// column to mean "no report", not "this gear is exempt from needing one",
// so treating it as a waiver let gears through whose blood work never
// happened. An unrecognized non-blank value is treated as still pending
// (gate it) rather than done — showing a diet plan before its checkpoint
// is actually confirmed is worse than a coach seeing one extra "waiting"
// gear that turns out to already be cleared.
function classifyBloodStatus(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t || t === 'na' || t === 'n/a') return 'not_provided';
  if (t === 'done') return 'done';
  return 'pending';
}

// A gear's own "Gear N Preparation status" is a separate, independent
// checkpoint from its blood-report one — a blood-cleared gear can still
// have no actual diet plan written up yet ("Pending", "call pending", or
// blank), in which case there's nothing to show regardless of blood
// status. Only an exact "done" (any case) counts as ready; anything
// else, including free text that ended up in this column by data-entry
// error, is treated as not ready rather than guessed at.
function isGearPrepDone(text) {
  return (text || '').trim().toLowerCase() === 'done';
}

/**
 * Parses one sheet's raw CSV text into { columns, isPersonSheet, rows }.
 * `rows` is an array of normalized person objects; raw[] keeps every original
 * cell (keyed by original header) for a generic fallback table view.
 */
function normalizeSheet(csvText) {
  const table = parseCSV(csvText);
  if (!table.length) return { headers: [], isPersonSheet: false, rows: [] };
  const headers = table[0];
  const displayHeaders = dedupeHeaders(headers);
  const dataRows = table.slice(1);

  const idIdx = findIndex(headers, [/student/, /id/]);
  const nameIdx = findIndex(headers, [/student/, /name/]) >= 0
    ? findIndex(headers, [/student/, /name/])
    : findIndex(headers, [/^name$/]);
  const contactIdx = findIndex(headers, [/contact/]);
  const batchIdx = findIndex(headers, [/batch/]);
  const hcIdx = findIndex(headers, [/assigned to/]) >= 0
    ? findIndex(headers, [/assigned to/])
    : findIndex(headers, [/health coach/]) >= 0
      ? findIndex(headers, [/health coach/])
      : findIndex(headers, [/^hc name$/]);
  const genderIdx = findIndex(headers, [/gender/]);
  const ageIdx = findIndex(headers, [/^age$/]);
  const heightIdx = findIndex(headers, [/height/]);
  const weightIdx = findIndex(headers, [/weight/]);

  // Days since course start, kept live by whoever edits the sheet — drives
  // the Mail Schedule reminders (Dashboard) and the Prep/Verification %
  // report, both of which reason in "Day N" terms rather than calendar dates.
  const currentDayIdx = findIndex(headers, [/^current day$/]);
  const introCallStatusIdx = findIndex(headers, [/intro call/, /status/]);

  // The one-time (not per-gear) date the person's blood report first came
  // in — distinct from each gear's own "Blood report Verification &
  // Analysis" reviewed-or-not checkpoint (gearBloodStatus below). Only some
  // sheet layouts have this column at all.
  const bloodReportDateIdx = findIndex(headers, [/blood report/, /entered/, /date/]);

  const vegIdx = findIndex(headers, [/veg/, /non/, /veg/]) >= 0
    ? findIndex(headers, [/veg/, /non/, /veg/])
    : findIndex(headers, [/diet preference/], [/language/]);
  const langIdx = findIndex(headers, [/language/]);

  const foodAllergyIdx = findIndex(headers, [/food/, /allerg/]) >= 0
    ? findIndex(headers, [/food/, /allerg/])
    : findIndex(headers, [/allerg/]);
  const dislikeFoodIdx = findIndex(headers, [/dislike/]);

  // Three columns the management front-page spec calls for that the sheet
  // doesn't carry today — added here so this reader picks them up the
  // moment they're added as new columns, same pattern as every field above.
  // "Secondary Condition" is deliberately its own column, not folded into
  // conditionIdxs below: that field concatenates several free-text clinical
  // columns into one blob with no primary/secondary distinction, which is
  // exactly what this new column exists to give a name to.
  const secondaryConditionIdx = findIndex(headers, [/secondary/, /condition/]);
  const pastHistoryIdx = findIndex(headers, [/past\s*history/]);
  const supplementIdx = findIndex(headers, [/supplement/]);

  const conditionIdxs = findAllExact(headers, (h) =>
    /diabetes/.test(h) || /current\s*symptoms/.test(h) || /other clinical/.test(h) ||
    /gut issue/.test(h) || /medical condition/.test(h) || /clinical.*surgical/.test(h)
  );

  // "Diet type" columns appear once per tracked block (GEAR4, GEAR3, GEAR2,
  // GEAR1, 365-day...), left-to-right in that order. We only care about the
  // first three, which are GEAR4/GEAR3/GEAR2.
  const dietTypeIdxs = findAllExact(headers, (h) => h === 'diet type');
  const gearDietTypeCols = {};
  const gearOrder = [4, 3, 2];
  dietTypeIdxs.slice(0, 3).forEach((idx, i) => { gearDietTypeCols[gearOrder[i]] = idx; });

  const gearStatusCols = {};
  for (const g of [2, 3, 4]) {
    const idx = findIndex(headers, [new RegExp(`gear\\s*${g}`), /preparation status/]);
    if (idx >= 0) gearStatusCols[g] = idx;
  }

  // Each gear has its own "blood report reviewed" checkpoint that gates
  // whether that gear's diet plan should be shown yet: a "Blood report
  // Verification & Analysis" column repeated once per gear block. Requiring
  // "verification"/"analysis" specifically (not just "blood report ...")
  // is what excludes the *different* columns that share the "blood report"
  // words but aren't this checkpoint — a plain, non-gear-specific "Blood
  // report status" / "...entered date" pair (the initial/final lab-result
  // summary, appears once near the top and again before the 365 block), and
  // on one sheet layout a "GEAR 3 DIET Blood report status" column that
  // tracks whether the report was *received* at all, a distinct, earlier
  // step from having actually been reviewed.
  //
  // Most occurrences don't name their own gear in the header text, so
  // they're assigned positionally in left-to-right GEAR4/3/2/1/365 block
  // order, same as "Diet type"/gear-status above; an occurrence that does
  // name its gear directly is trusted over that positional guess.
  const bloodVerificationIdxs = findAllExact(
    headers,
    (h) => /blood/.test(h) && /report/.test(h) && (/verification/.test(h) || /analysis/.test(h))
  );
  const bloodVerificationCols = zipToGearBlocks(bloodVerificationIdxs, headers);

  // "TL verification" (Team Lead sign-off), repeated per gear block, same
  // way as blood verification above. Excludes "TL Verification Date" and
  // "TL Remarks", which share the "tl" + "verif..." words but are separate
  // columns.
  const tlVerificationIdxs = findAllExact(
    headers,
    (h) => /\btl\b/.test(h) && /verif/.test(h) && !/date/.test(h)
  );
  const tlVerificationCols = zipToGearBlocks(tlVerificationIdxs, headers);

  // The date a TL marked that gear "Verified" — the one column the
  // exclusion above specifically carves out of tlVerificationIdxs.
  const tlVerificationDateIdxs = findAllExact(
    headers,
    (h) => /\btl\b/.test(h) && /verif/.test(h) && /date/.test(h)
  );
  const tlVerificationDateCols = zipToGearBlocks(tlVerificationDateIdxs, headers);

  // Free-text TL remarks, repeated per gear block. Deliberately just
  // "tl" + "remark" (not "tl remarks" verbatim) since one sheet layout has a
  // trailing newline/space in this header.
  const tlRemarksIdxs = findAllExact(headers, (h) => /\btl\b/.test(h) && /remark/.test(h));
  const tlRemarksCols = zipToGearBlocks(tlRemarksIdxs, headers);

  // "Diet Accuracy (TL)" / "Diet Quality (TL)" — proposed new per-gear TL
  // rating columns (see the Template tab), not present on every sheet layout
  // yet. Missing entirely (idxs empty) just means gearDietAccuracy/
  // gearDietQuality come back empty for that sheet, same "nothing to gate
  // on" rule as the other optional columns above.
  const dietAccuracyIdxs = findAllExact(headers, (h) => /diet accuracy/.test(h) && /tl/.test(h));
  const dietAccuracyCols = zipToGearBlocks(dietAccuracyIdxs, headers);
  const dietQualityIdxs = findAllExact(headers, (h) => /diet quality/.test(h) && /tl/.test(h));
  const dietQualityCols = zipToGearBlocks(dietQualityIdxs, headers);

  // Blood lab findings, repeated per gear block alongside the
  // pass/fail-style "Blood report Verification & Analysis" checkpoint above
  // — these are the actual values (e.g. "GRADE I FATTY LIVER, LYMPHOCYTES
  // 45 ↑"), not read into the row object anywhere else.
  const fastingIdxs = findAllExact(headers, (h) => /fasting/.test(h));
  const fastingCols = zipToGearBlocks(fastingIdxs, headers);
  const postPrandialIdxs = findAllExact(headers, (h) => /post\s*prandial/.test(h));
  const postPrandialCols = zipToGearBlocks(postPrandialIdxs, headers);
  const hba1cIdxs = findAllExact(headers, (h) => /hba1c/.test(h));
  const hba1cCols = zipToGearBlocks(hba1cIdxs, headers);
  const otherFindingsIdxs = findAllExact(headers, (h) => /other/.test(h) && /finding/.test(h));
  const otherFindingsCols = zipToGearBlocks(otherFindingsIdxs, headers);

  // Per-gear Expected/Due/Actual date triples. "Due Date" repeats once per
  // gear block (GEAR4/GEAR3/GEAR2/GEAR1/365-day), and in every sheet layout
  // seen the Expected/Start date column immediately precedes it and the
  // Actual Date column immediately follows it. Which *gear* a given "Due
  // Date" belongs to can't be assumed from position alone: not every sheet
  // has all five blocks (DD104 has no Due Date at all for GEAR3/GEAR4, only
  // for GEAR2/GEAR1/365), so a fixed [4,3,2,1,365] zip silently mislabels
  // everything once a block is missing. Instead, identify the block from
  // its own header text — "GEAR n DIET ..." or "365 DIET ..." — searching
  // backward from the Due Date column for the nearest header that names it
  // (within a handful of columns; column layouts put it 1-2 columns back).
  const dueDateIdxs = findAllExact(headers, (h) => h === 'due date');
  const gearDateCols = {};
  const BLOCK_LOOKBACK = 6;
  dueDateIdxs.forEach((dueIdx) => {
    const prevHeader = normHeader(headers[dueIdx - 1]);
    const expectedIdx = /expected|start/.test(prevHeader) && /date/.test(prevHeader) ? dueIdx - 1 : -1;
    const nextHeader = normHeader(headers[dueIdx + 1]);
    const actualIdx = nextHeader === 'actual date' ? dueIdx + 1 : -1;

    let g = null;
    for (let back = 1; back <= BLOCK_LOOKBACK && dueIdx - back >= 0; back++) {
      const h = normHeader(headers[dueIdx - back]);
      const gearMatch = h.match(/gear\s*(\d)/);
      if (gearMatch) { g = Number(gearMatch[1]); break; }
      if (/365/.test(h)) { g = 365; break; }
    }
    if (g === null) return; // couldn't confidently identify which block this belongs to

    gearDateCols[g] = { expectedIdx, dueIdx, actualIdx };
  });

  const isPersonSheet = nameIdx >= 0;

  // Both "Batch Details" and "DD104 - DD113 DATE" are coach-batch rollups
  // (one row per batch — DD104, DD105A, ...), not person sheets — neither
  // has a Student Name/ID column, so isPersonSheet is false and they'd
  // otherwise fall through to the generic raw-table view. An exact "Batch"
  // or "Batch Name" header is what marks a sheet as this shape
  // specifically, as opposed to a person sheet's own "L2 Batch" column,
  // which also contains the word "batch" but never matches either exactly.
  const batchNameIdx = findIndex(headers, [/^batch\s*(name)?$/]);
  const isBatchSheet = !isPersonSheet && batchNameIdx >= 0;

  const categoryIdx = findIndex(headers, [/^category$/]);
  const tlNameIdx = findIndex(headers, [/^tl name$/]);
  const batchStatusIdx = findIndex(headers, [/^status$/]);
  const dohIdx = findIndex(headers, [/^doh$/]);
  const doeIdx = findIndex(headers, [/^doe\b/]);
  const courseStartDateIdx = findIndex(headers, [/course start date/]);
  const daysSinceJoinedIdx = findIndex(headers, [/days since joined/]);
  const totalHandoverIdx = findIndex(headers, [/total handover/]);

  // The sheet has two near-identically-named health-coach columns ("HEALTH
  // COACH NAME " and "Health Coach Name") that only differ in case/spacing
  // — normHeader collapses both to the same string, so a single findIndex
  // would always land on whichever comes first even when it's the blank
  // one. Collecting every match and taking the first non-blank cell per row
  // sidesteps needing to guess which index is "the real one" ahead of time.
  const healthCoachNameIdxs = findAllExact(headers, (h) => h === 'health coach name');

  // Two different per-gear date shapes show up across the batch-rollup
  // sheets: "Batch Details" has a "Gear N End date" / "Actual End date" /
  // "Efficiency" triple per gear (the first names its own gear directly,
  // same convention as the Due Date triples above), while "DD104 - DD113
  // DATE" has just a single "Gear N Actual Date" column. Both populate the
  // same batchGearStatCols shape — actualEndDateIdx always set, the other
  // two only when that sheet actually has them — so BatchCard doesn't need
  // to know which layout it's reading.
  const batchGearStatCols = {};
  findAllExact(headers, (h) => /^gear\s*[234]\s*end date$/.test(h)).forEach((idx) => {
    const m = normHeader(headers[idx]).match(/gear\s*([234])/);
    if (!m) return;
    batchGearStatCols[Number(m[1])] = { endDateIdx: idx, actualEndDateIdx: idx + 1, efficiencyIdx: idx + 2 };
  });
  findAllExact(headers, (h) => /^gear\s*[234]\s*actual\s*date$/.test(h)).forEach((idx) => {
    const m = normHeader(headers[idx]).match(/gear\s*([234])/);
    if (!m || batchGearStatCols[Number(m[1])]) return; // triple-shape match already covers this gear
    batchGearStatCols[Number(m[1])] = { endDateIdx: -1, actualEndDateIdx: idx, efficiencyIdx: -1 };
  });

  const rows = [];
  dataRows.forEach((row, i) => {
    if (!row.some((v) => v && v.trim())) return; // fully blank row
    const name = cell(row, nameIdx);
    if (isPersonSheet && !name) return;
    if (isBatchSheet && !cell(row, batchNameIdx)) return;

    const conditionRaw = conditionIdxs.map((idx) => cell(row, idx)).filter(Boolean).join(' | ');

    const gearDietType = {};
    for (const g of [2, 3, 4]) {
      if (gearDietTypeCols[g] !== undefined) gearDietType[g] = cell(row, gearDietTypeCols[g]);
    }
    const gearStatus = {};
    const gearReady = {};
    for (const g of [2, 3, 4]) {
      if (gearStatusCols[g] !== undefined) {
        const raw = cell(row, gearStatusCols[g]);
        gearStatus[g] = raw;
        gearReady[g] = isGearPrepDone(raw);
      }
    }

    // Only set when this sheet actually has that gear's own column — a
    // sheet layout that doesn't track it (e.g. a rollup tab) shouldn't gate
    // a gear it has no data for; missing key means "nothing to gate on".
    const gearBloodStatus = {};
    for (const g of [2, 3, 4]) {
      if (bloodVerificationCols[g] !== undefined) gearBloodStatus[g] = classifyBloodStatus(cell(row, bloodVerificationCols[g]));
    }

    // Only an exact "Verified" counts — "Pending", blank, or anything else
    // is treated as not yet verified, same conservative rule as blood
    // status and gear-prep status above.
    const gearTLVerified = {};
    const gearTLVerificationDate = {};
    const gearTLRemarks = {};
    const gearDietAccuracy = {};
    const gearDietQuality = {};
    for (const g of [2, 3, 4]) {
      if (tlVerificationCols[g] !== undefined) {
        gearTLVerified[g] = cell(row, tlVerificationCols[g]).trim().toLowerCase() === 'verified';
      }
      if (tlVerificationDateCols[g] !== undefined) gearTLVerificationDate[g] = cell(row, tlVerificationDateCols[g]);
      if (tlRemarksCols[g] !== undefined) gearTLRemarks[g] = cell(row, tlRemarksCols[g]);
      if (dietAccuracyCols[g] !== undefined) gearDietAccuracy[g] = cell(row, dietAccuracyCols[g]);
      if (dietQualityCols[g] !== undefined) gearDietQuality[g] = cell(row, dietQualityCols[g]);
    }

    const gearBloodFindings = {};
    for (const g of [2, 3, 4]) {
      const fasting = fastingCols[g] !== undefined ? cell(row, fastingCols[g]) : '';
      const postPrandial = postPrandialCols[g] !== undefined ? cell(row, postPrandialCols[g]) : '';
      const hba1c = hba1cCols[g] !== undefined ? cell(row, hba1cCols[g]) : '';
      const otherFindings = otherFindingsCols[g] !== undefined ? cell(row, otherFindingsCols[g]) : '';
      if (fasting || postPrandial || hba1c || otherFindings) {
        gearBloodFindings[g] = { fasting, postPrandial, hba1c, otherFindings };
      }
    }

    const gearDates = {};
    for (const g of [2, 3, 4]) {
      const cols = gearDateCols[g];
      if (!cols) continue;
      const expected = cols.expectedIdx >= 0 ? cell(row, cols.expectedIdx) : '';
      const due = cell(row, cols.dueIdx);
      const actual = cols.actualIdx >= 0 ? cell(row, cols.actualIdx) : '';
      if (expected || due || actual) gearDates[g] = { expected, due, actual };
    }

    const healthCoachName = healthCoachNameIdxs.map((idx) => cell(row, idx)).find(Boolean) || '';

    const batchGearStats = {};
    for (const g of [2, 3, 4]) {
      const cols = batchGearStatCols[g];
      if (!cols) continue;
      const endDate = cell(row, cols.endDateIdx);
      const actualEndDate = cell(row, cols.actualEndDateIdx);
      const efficiency = cell(row, cols.efficiencyIdx);
      if (endDate || actualEndDate || efficiency) batchGearStats[g] = { endDate, actualEndDate, efficiency };
    }

    const rawObj = {};
    displayHeaders.forEach((key, idx) => {
      const val = cell(row, idx);
      if (val) rawObj[key] = val;
    });

    rows.push({
      rowIndex: i,
      studentId: cell(row, idIdx),
      name,
      contact: cell(row, contactIdx),
      batch: cell(row, batchIdx),
      hcName: cell(row, hcIdx),
      category: cell(row, categoryIdx),
      tlName: cell(row, tlNameIdx),
      batchStatus: cell(row, batchStatusIdx),
      doh: cell(row, dohIdx),
      doe: cell(row, doeIdx),
      courseStartDate: cell(row, courseStartDateIdx),
      daysSinceJoined: cell(row, daysSinceJoinedIdx),
      totalHandover: cell(row, totalHandoverIdx),
      healthCoachName,
      batchGearStats,
      gender: cell(row, genderIdx),
      age: cell(row, ageIdx),
      height: cell(row, heightIdx),
      weight: cell(row, weightIdx),
      currentDay: currentDayIdx >= 0 && /^\d+$/.test(cell(row, currentDayIdx)) ? Number(cell(row, currentDayIdx)) : null,
      introCallStatus: cell(row, introCallStatusIdx),
      bloodReportDate: cell(row, bloodReportDateIdx),
      vegPreference: classifyVeg(cell(row, vegIdx)),
      language: classifyLanguage(cell(row, langIdx)),
      conditionRaw,
      foodAllergy: cell(row, foodAllergyIdx),
      dislikeFood: cell(row, dislikeFoodIdx),
      secondaryCondition: cell(row, secondaryConditionIdx),
      pastHistory: cell(row, pastHistoryIdx),
      supplement: cell(row, supplementIdx),
      gearDietType,
      gearStatus,
      gearReady,
      gearDates,
      gearBloodStatus,
      gearTLVerified,
      gearTLVerificationDate,
      gearTLRemarks,
      gearDietAccuracy,
      gearDietQuality,
      gearBloodFindings,
      raw: rawObj,
    });
  });

  return { headers: displayHeaders, isPersonSheet, isBatchSheet, rows };
}

module.exports = { normalizeSheet };
