// Mirrors server/lib/bmi.js exactly — the client re-derives BMI for display
// rather than depending on a server round-trip. Keep both in sync if this
// logic ever changes. See that file's comment for why height parsing is a
// heuristic: the sheet mixes cm and feet.inches in the same column with no
// unit marker.
function parseHeightCm(raw) {
  const text = (raw || '').toString().trim();
  if (!text) return null;
  const m = text.match(/^(\d+)(?:[.'](\d{1,2}))?/);
  if (!m) return null;
  const whole = Number(m[1]);
  if (!whole) return null;
  if (!m[2]) {
    return whole >= 10 ? whole : whole * 30.48;
  }
  const frac = Number(m[2]);
  if (whole >= 10) return whole;
  const inches = Math.min(frac, 11);
  return (whole * 12 + inches) * 2.54;
}

function parseWeightKg(raw) {
  const text = (raw || '').toString().trim();
  if (!text) return null;
  const m = text.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const kg = Number(m[1]);
  return kg > 0 ? kg : null;
}

function computeBMI(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Number.isFinite(bmi) ? bmi : null;
}

function bmiCategory(bmi) {
  if (bmi == null) return null;
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'overweight';
  return 'obese';
}

const BMI_CATEGORY_LABELS = {
  underweight: 'Underweight',
  normal: 'Normal',
  overweight: 'Overweight',
  obese: 'Obese',
};

// Ideal Body Weight — the management document's own formula (Broca index,
// gender-unaware): IBW (kg) = height in cm − 100. Simple by design; not a
// clinical judgment call the way the blood-report thresholds are, since the
// source document states this exact rule rather than leaving it to us.
function computeIBW(heightCm) {
  if (!heightCm) return null;
  const ibw = heightCm - 100;
  return ibw > 0 ? ibw : null;
}

export { parseHeightCm, parseWeightKg, computeBMI, bmiCategory, BMI_CATEGORY_LABELS, computeIBW };
