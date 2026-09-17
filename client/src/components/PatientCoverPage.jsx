// Patient-summary front matter that opens every gear — matches the
// management team's own "FRONT PAGE - ENGLISH.docx" template: the branded
// hero graphic as its own intro page, then "Diet Preference Questionnaire"
// and its three labeled tables — Personal Details / Diet & Other Preference
// / Clinical Details — starting fresh on the next page (see .diet-cover-intro's
// print break-after in App.css). The source template's tables are a blank
// form with placeholder text ("Column F", "Column M (yrs)" — spreadsheet
// cell references meant for a human to fill in by hand); this is that same
// page filled in live from the actual patient record instead, via CoverTable
// below.
//
// This is the same component regardless of which gear is open — per the
// management document, the front page must not change based on Gear, only
// the "Diet Name" line (via `gear`/`mealLabels`) and the diet content below
// this card do.
import { cloneElement } from 'react';
import coverHero from '../assets/diet-cover-hero.jpg';
import { CONDITION_LABELS, DIET_LABELS } from '../lib/labels';
import { detectPersonCondition } from '../lib/matchDiet';
import { parseHeightCm, parseWeightKg, computeBMI, bmiCategory, BMI_CATEGORY_LABELS, computeIBW } from '../lib/bmi';
import { FINDING_LABELS, categorizeBloodFinding } from '../lib/bloodFindings';
import { RemarkFlag, renderWithHighlight } from './RemarkFlag';

// One row of a CoverTable — value is shown as an em dash rather than being
// dropped when absent, so the row's own label still tells a coach which
// field is simply blank on this patient's sheet vs. never asked at all.
// remarkKey/remarkCtx/gear are injected from outside (see the cloneElement
// calls in PatientCoverPage's render below) rather than threaded through
// every one of the ~20 catalog entries' own render(ctx) calls above — same
// TL "highlight mode" flag/badge and only-the-selected-text highlighting as
// everywhere else in the plan (see RemarkFlag.jsx), just reaching a field
// whose value is a plain string here instead of a recipe/schedule line.
function Row({ label, value, children, remarkKey, remarkCtx, gear }) {
  const pending = remarkCtx && remarkKey && remarkCtx.pendingByKey.get(remarkKey);
  const highlighted = pending && typeof value === 'string' ? renderWithHighlight(value, pending.highlightedText, 'diet-remark-line-highlighted') : null;
  const rowFallbackHighlighted = pending && !highlighted;
  return (
    <tr id={remarkKey ? `remark-${remarkKey}` : undefined} data-remark-key={remarkCtx && remarkKey ? remarkKey : undefined} className={rowFallbackHighlighted ? 'diet-remark-row-highlighted' : undefined}>
      <th scope="row">
        {remarkKey && <RemarkFlag remarkKey={remarkKey} remarkCtx={remarkCtx} gear={gear} highlightedText={typeof value === 'string' && value ? value : label} />}
        {label}
      </th>
      <td>{highlighted || children || value || <span className="diet-cover-empty">—</span>}</td>
    </tr>
  );
}

// One of the template's three named tables (Personal Details / Diet & Other
// Preference / Clinical Details) — same bordered two-column look as the
// meal-plan tables (.diet-table) elsewhere in this view, headed by its own
// section title exactly as the source document names it.
function CoverTable({ title, children }) {
  return (
    <div className="diet-cover-table-block">
      <h3 className="diet-cover-table-title">{title}</h3>
      <div className="diet-table-wrap">
        <table className="diet-table diet-cover-table">
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// The management document's own instruction: moderate/borderline findings
// in a yellow table, high/abnormal in a red one. `otherFindings` is free
// text and can't be thresholded (categorizeBloodFinding returns null for
// it) — shown plainly rather than colored, never silently dropped. Nested
// inside Clinical Details, under Past History — the source template lists
// "Blood Report Findings" as that table's own last row.
function BloodReportPanel({ gearBloodFindings }) {
  if (!gearBloodFindings) return null;
  const rows = [];
  for (const gear of [2, 3, 4]) {
    const findings = gearBloodFindings[gear];
    if (!findings) continue;
    for (const kind of Object.keys(FINDING_LABELS)) {
      const value = findings[kind];
      if (!value) continue;
      rows.push({ gear, kind, value, category: categorizeBloodFinding(kind, value) });
    }
  }
  if (!rows.length) return null;

  const flagged = rows.filter((r) => r.category === 'moderate' || r.category === 'high');
  const plain = rows.filter((r) => !r.category);

  return (
    <div className="diet-cover-blood">
      {!!flagged.length && (
        <table className="diet-cover-blood-table">
          <tbody>
            {flagged.map((r, i) => (
              <tr key={i} className={`diet-cover-blood-row diet-cover-blood-row-${r.category}`}>
                <td>Gear {r.gear} · {FINDING_LABELS[r.kind]}</td>
                <td>{r.value}</td>
                <td className="diet-cover-blood-cat">{r.category === 'high' ? 'High / Abnormal' : 'Moderate / Borderline'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!!plain.length && (
        <p className="diet-cover-blood-other">
          {plain.map((r) => `Gear ${r.gear} ${FINDING_LABELS[r.kind]}: ${r.value}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

// The fixed catalog behind the "Patient Details Edit" sidebar page — every
// field it can show or hide on the Personal Details table, and how to render
// each one. Keyed to match ALL_FIELD_KEYS in server/lib/
// patientDetailFieldsStore.js exactly (the server validates against that
// same list, so a mismatch here would mean a saved key silently renders
// nothing rather than erroring — kept in sync deliberately, same convention
// as bmi.js's client/server mirror elsewhere in this app). `ctx` carries the
// values already computed once in the component body below (person plus the
// derived heightCm/bmi/bmiCat/ibw), so adding a field back never needs its
// own new computation — every catalog entry's data is already sitting in
// scope, it's purely a visibility toggle.
const PERSONAL_DETAIL_FIELDS = {
  name: { label: 'Name', render: (ctx) => <Row key="name" label="Name" value={ctx.person && ctx.person.name} /> },
  studentId: { label: 'Student ID', render: (ctx) => <Row key="studentId" label="Student ID" value={ctx.person && ctx.person.studentId} /> },
  batch: { label: 'Batch', render: (ctx) => <Row key="batch" label="Batch" value={ctx.person && ctx.person.batch} /> },
  hcName: { label: 'Health Coach', render: (ctx) => <Row key="hcName" label="Health Coach" value={ctx.person && ctx.person.hcName} /> },
  gender: { label: 'Gender', render: (ctx) => <Row key="gender" label="Gender" value={ctx.person && ctx.person.gender} /> },
  contact: { label: 'Contact Number', render: (ctx) => <Row key="contact" label="Contact Number" value={ctx.person && ctx.person.contact} /> },
  age: { label: 'Age', render: (ctx) => <Row key="age" label="Age" value={ctx.person && ctx.person.age && `${ctx.person.age} yrs`} /> },
  // Always cm regardless of how it was entered — the sheet mixes cm and
  // feet.inches in one column with no unit marker, and the management
  // document requires cm display either way.
  height: { label: 'Height', render: (ctx) => <Row key="height" label="Height" value={ctx.heightCm && `${Math.round(ctx.heightCm)} cm`} /> },
  weight: { label: 'Weight', render: (ctx) => <Row key="weight" label="Weight" value={ctx.person && ctx.person.weight && `${ctx.person.weight} kg`} /> },
  bmi: {
    label: 'BMI',
    render: (ctx) => (
      <Row key="bmi" label="BMI">
        {ctx.bmi
          ? <span className={`tag tag-bmi tag-bmi-${ctx.bmiCat} diet-cover-inline-tag`}>{ctx.bmi.toFixed(1)} kg/m² · {BMI_CATEGORY_LABELS[ctx.bmiCat]}</span>
          : null}
      </Row>
    ),
  },
  ibw: { label: 'IBW', render: (ctx) => <Row key="ibw" label="IBW" value={ctx.ibw && `${Math.round(ctx.ibw)} kg  (Ht in cm − 100)`} /> },
};
const DEFAULT_PERSONAL_DETAIL_FIELD_KEYS = ['name', 'batch', 'age', 'height', 'weight', 'bmi', 'ibw'];

// The fixed catalog behind the "Diet & Other Preference" table -- same idea
// as PERSONAL_DETAIL_FIELDS above, keyed to match FIELD_CATALOG.dietPreference
// in server/lib/patientDetailFieldsStore.js. `ctx` is the same context object
// PERSONAL_DETAIL_FIELDS.render receives.
const DIET_PREFERENCE_FIELDS = {
  dietName: { label: 'Diet Name', render: (ctx) => <Row key="dietName" label="Diet Name" value={ctx.dietName} /> },
  preparedBy: { label: 'Diet Prepared By', render: (ctx) => <Row key="preparedBy" label="Diet Prepared By" value={ctx.preparedBy} /> },
  dietaryChoice: { label: 'Dietary Choice', render: (ctx) => <Row key="dietaryChoice" label="Dietary Choice" value={ctx.dietPref} /> },
  supplement: { label: 'Supplement', render: (ctx) => <Row key="supplement" label="Supplement" value={ctx.person && ctx.person.supplement} /> },
  foodAllergies: { label: 'Food Allergies', render: (ctx) => <Row key="foodAllergies" label="Food Allergies" value={ctx.person && ctx.person.foodAllergy} /> },
  foodDislikes: { label: 'Food Dislikes', render: (ctx) => <Row key="foodDislikes" label="Food Dislikes" value={ctx.person && ctx.person.dislikeFood} /> },
};
const DEFAULT_DIET_PREFERENCE_FIELD_KEYS = ['dietName', 'preparedBy', 'dietaryChoice', 'supplement', 'foodAllergies', 'foodDislikes'];

// The fixed catalog behind the "Clinical Details" table -- same idea, keyed
// to match FIELD_CATALOG.clinicalDetails in patientDetailFieldsStore.js.
// bloodReportFindings' render already returns null when there is nothing to
// show, same convention as the bmi row above.
const CLINICAL_DETAIL_FIELDS = {
  primaryCondition: { label: 'Primary Condition', render: (ctx) => <Row key="primaryCondition" label="Primary Condition" value={ctx.primaryCondition} /> },
  secondaryCondition: { label: 'Secondary Condition', render: (ctx) => <Row key="secondaryCondition" label="Secondary Condition" value={ctx.person && ctx.person.secondaryCondition} /> },
  pastHistory: { label: 'Past History / Other Symptoms', render: (ctx) => <Row key="pastHistory" label="Past History / Other Symptoms" value={ctx.person && ctx.person.pastHistory} /> },
  bloodReportFindings: {
    label: 'Blood Report Findings',
    render: (ctx) => (ctx.person && ctx.person.gearBloodFindings ? (
      <Row key="bloodReportFindings" label="Blood Report Findings">
        <BloodReportPanel gearBloodFindings={ctx.person.gearBloodFindings} />
      </Row>
    ) : null),
  },
};
const DEFAULT_CLINICAL_DETAIL_FIELD_KEYS = ['primaryCondition', 'secondaryCondition', 'pastHistory', 'bloodReportFindings'];

function PatientCoverPage({ person, generatedAt, gear, mealLabels, personalDetailFields, dietPreferenceFields, clinicalDetailFields, remarkCtx }) {
  const detected = person ? detectPersonCondition(person) : null;
  const conditionLabel = detected ? CONDITION_LABELS[detected.conditions[0]] + (detected.comorbid ? ' + Gastric/Ulcer/Acidity' : '') : null;
  // The sheet's own free-text condition column, when it says more than the
  // auto-detected label does (e.g. "Type 2 Diabetes" vs just "Diabetes") —
  // preferred for the Primary Condition row since it's the more specific of
  // the two; the auto-detected label is what actually drives which diet
  // gets served, so it still appears whenever the sheet has nothing of its own.
  const primaryCondition = (person && person.conditionRaw) || conditionLabel;
  const heightCm = person ? parseHeightCm(person.height) : null;
  const bmi = person ? computeBMI(heightCm, parseWeightKg(person.weight)) : null;
  const bmiCat = bmiCategory(bmi);
  const ibw = computeIBW(heightCm);
  const dietPref = person && person.vegPreference ? DIET_LABELS[person.vegPreference] : null;
  // "Gear 2 (Breakfast + Lunch + Dinner)" — built from the actual resolved
  // meal chain, not hardcoded, so it's automatically right whether this
  // gear covers one meal or three.
  const dietName = gear && mealLabels && mealLabels.length ? `Gear ${gear} (${mealLabels.join(' + ')})` : null;
  const preparedBy = person && person.hcName ? `${person.hcName} — Senior Health Coach` : null;
  const ctx = { person, heightCm, bmi, bmiCat, ibw, dietName, preparedBy, dietPref, primaryCondition };

  // Same remarkKey "namespace" convention as DietTemplateView.jsx's own
  // recipeRemarkKey/scheduleRowRemarkKey/etc — a stable, deterministic key
  // per field (gear + this table's title + the field's own catalog key,
  // never DOM state), matched by a `cover:` prefix branch in that file's
  // findRemarkLocation so "jump to this remark" from the Diet Remarks page
  // still works for a cover-page field.
  const remarkKeyFor = (tableTitle, fieldKey) => `cover:${gear}:${tableTitle}:${fieldKey}`;
  // Every catalog entry's render(ctx) above already returns exactly one
  // <Row>, built without knowing about remarks at all — cloneElement injects
  // the three remark props from outside instead of threading them through
  // all ~20 entries individually. Guards against `bloodReportFindings`
  // (and any other entry) legitimately returning null.
  const withRemark = (tableTitle, key, element) => (element ? cloneElement(element, { remarkKey: remarkKeyFor(tableTitle, key), remarkCtx, gear }) : element);

  return (
    <>
      {/* A standalone intro page — just the branded hero graphic, nothing
          else — so it prints as its own page 1 (see .diet-cover-intro's
          break-after in the print media block) instead of sharing a page
          with the questionnaire tables below. */}
      <div className="diet-cover-intro">
        <img className="diet-cover-hero" src={coverHero} alt="My Health School — Diet Plan: A Step Towards a Healthier You" />
      </div>

      <div className="diet-cover-card">
        <div className="diet-cover-header-row">
          <h2 className="diet-cover-heading">Diet Preference Questionnaire</h2>
          {generatedAt && <span className="diet-cover-date">Generated {generatedAt}</span>}
        </div>

        <CoverTable title="Personal Details">
          {(personalDetailFields || DEFAULT_PERSONAL_DETAIL_FIELD_KEYS)
            .filter((key) => PERSONAL_DETAIL_FIELDS[key])
            .map((key) => withRemark('Personal Details', key, PERSONAL_DETAIL_FIELDS[key].render(ctx)))}
        </CoverTable>

        <CoverTable title="Diet & Other Preference">
          {(dietPreferenceFields || DEFAULT_DIET_PREFERENCE_FIELD_KEYS)
            .filter((key) => DIET_PREFERENCE_FIELDS[key])
            .map((key) => withRemark('Diet & Other Preference', key, DIET_PREFERENCE_FIELDS[key].render(ctx)))}
        </CoverTable>

        <CoverTable title="Clinical Details">
          {(clinicalDetailFields || DEFAULT_CLINICAL_DETAIL_FIELD_KEYS)
            .filter((key) => CLINICAL_DETAIL_FIELDS[key])
            .map((key) => withRemark('Clinical Details', key, CLINICAL_DETAIL_FIELDS[key].render(ctx)))}
        </CoverTable>
      </div>
    </>
  );
}

// Read by PatientDetailFieldsPage (the "Patient Details Edit" sidebar page)
// so its checklist labels can never drift from what this component actually
// renders — {key: label} for every field the catalog above knows about, in
// the catalog's own fixed display order.
const PERSONAL_DETAIL_FIELD_LABELS = Object.fromEntries(
  Object.entries(PERSONAL_DETAIL_FIELDS).map(([key, { label }]) => [key, label]),
);
const DIET_PREFERENCE_FIELD_LABELS = Object.fromEntries(
  Object.entries(DIET_PREFERENCE_FIELDS).map(([key, { label }]) => [key, label]),
);
const CLINICAL_DETAIL_FIELD_LABELS = Object.fromEntries(
  Object.entries(CLINICAL_DETAIL_FIELDS).map(([key, { label }]) => [key, label]),
);

export default PatientCoverPage;
export {
  PERSONAL_DETAIL_FIELD_LABELS, DEFAULT_PERSONAL_DETAIL_FIELD_KEYS,
  DIET_PREFERENCE_FIELD_LABELS, DEFAULT_DIET_PREFERENCE_FIELD_KEYS,
  CLINICAL_DETAIL_FIELD_LABELS, DEFAULT_CLINICAL_DETAIL_FIELD_KEYS,
};
