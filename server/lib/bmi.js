// Height/weight parsing + BMI. The sheet's Height column has no unit marker
// and mixes formats in the same column — e.g. "172" (cm) next to "5.2",
// "5.6" (feet.inches) — so this is a heuristic, not an exact parse: a value
// >= 10 is read as centimeters, anything smaller as feet.inches notation
// (the digits after the point are inches, not decimal feet — "5.2" means
// 5'2", not 5.2 feet). Callers should always show the raw sheet value
// alongside the computed BMI so staff can sanity-check it.
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
  if (whole >= 10) return whole; // e.g. "172.5" — already cm, ignore stray decimal
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

// Mirrors client/src/lib/bmi.js's computeIBW — see that file's comment for
// the formula source. Kept here too even though nothing server-side calls it
// yet, matching this file's own "keep both in sync" convention.
function computeIBW(heightCm) {
  if (!heightCm) return null;
  const ibw = heightCm - 100;
  return ibw > 0 ? ibw : null;
}

module.exports = { parseHeightCm, parseWeightKg, computeBMI, bmiCategory, computeIBW };
