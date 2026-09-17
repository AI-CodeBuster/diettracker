// Scans server/content for diet-plan .docx files and builds manifest.json,
// a structured index of {condition, comorbid, gear, dietType, language} -> file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const OUT_FILE = path.join(__dirname, '..', 'manifest.json');

function walk(dir, base = dir) {
  const out = [];
  // Deliberately not fs.readdirSync(dir, { withFileTypes: true }) — on this
  // Windows/OneDrive setup, Dirent.isFile()/isDirectory() silently reports
  // the wrong type (neither file nor directory) for any entry whose name
  // starts with a leading space, so those entries vanish from the walk with
  // no error at all. A plain readdirSync + separate statSync per entry
  // doesn't have that problem and finds all of them.
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else if (stat.isFile() && name.toLowerCase().endsWith('.docx') && !name.startsWith('~$')) {
      out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
    }
  }
  return out;
}

function detectGear(text) {
  const m = text.match(/gear\s*([1-4])/i);
  return m ? Number(m[1]) : null;
}

function detectDietType(text) {
  const t = text.toLowerCase();
  if (/\begg(etarian)?\b/.test(t)) return 'EGG';
  if (/\bnon[\s-]?veg\b/.test(t) || /\bnv\b/.test(t)) return 'NONVEG';
  if (/\bveg\b/.test(t)) return 'VEG';
  return null;
}

function detectLanguage(text) {
  const t = text.toLowerCase();
  if (/\btam(il)?/.test(t)) return 'TAM';
  if (/\beng(lish)?/.test(t)) return 'ENG';
  return null;
}

function detectBaseCondition(text) {
  const t = text.toLowerCase();
  if (/kidney/.test(t)) return 'KIDNEY';
  if (/thyroid/.test(t)) return 'THYROID';
  if (/diabet/.test(t)) return 'DIABETES';
  // Source folder/filenames consistently misspell this "CHOLESTROL" — match
  // both that and the correct spelling.
  if (/cholestrol|cholesterol/.test(t)) return 'CHOLESTEROL';
  if (/\bbp\b/.test(t)) return 'BP';
  return null;
}

function detectComorbid(text) {
  const t = text.toLowerCase();
  if (/gastric|ulcer|acid/.test(t)) return 'GASTRIC';
  return null;
}

const files = walk(CONTENT_DIR);
const manifest = [];
const skipped = [];

for (const { full, rel } of files) {
  const topFolder = rel.split('/')[0];
  const isAcidityZip = /gastric|acidity|ulcer/i.test(topFolder);

  const searchText = rel; // full relative path carries all the signal we need

  const gear = detectGear(searchText);
  const dietType = detectDietType(searchText);
  const language = detectLanguage(searchText);
  let condition = detectBaseCondition(searchText);
  let comorbid = isAcidityZip ? 'GASTRIC' : detectComorbid(searchText);

  if (!condition && isAcidityZip) {
    // fall back: base condition folder name is the 2nd path segment, e.g. "DIABETES+ GASTRIC"
    condition = detectBaseCondition(rel.split('/')[1] || '');
  }

  if (!gear || !dietType || !language || !condition) {
    skipped.push({ rel, gear, dietType, language, condition });
    continue;
  }

  const id = crypto.createHash('md5').update(rel).digest('hex').slice(0, 12);
  const stat = fs.statSync(full);

  manifest.push({
    id,
    condition,       // DIABETES | THYROID | KIDNEY | BP
    comorbid,        // GASTRIC | null
    gear,            // 2 | 3 | 4
    dietType,        // VEG | NONVEG | EGG
    language,        // TAM | ENG
    relPath: rel,
    fileName: path.basename(rel),
    sizeBytes: stat.size,
  });
}

fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2));

console.log(`Manifest built: ${manifest.length} files indexed, ${skipped.length} skipped.`);
if (skipped.length) {
  console.log('\nSkipped files (could not fully classify):');
  for (const s of skipped) console.log(' -', JSON.stringify(s));
}

// Sanity: print distribution
const byCond = {};
for (const m of manifest) {
  const key = `${m.condition}${m.comorbid ? '+' + m.comorbid : ''} / GEAR${m.gear}`;
  byCond[key] = (byCond[key] || 0) + 1;
}
console.log('\nDistribution:');
for (const [k, v] of Object.entries(byCond).sort()) console.log(' ', k, '=', v);
