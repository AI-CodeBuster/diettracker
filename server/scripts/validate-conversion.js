// Scores the .docx -> diet-data converter against the only ground truth there
// is: the two files that were transcribed and verified by hand. Run from
// server/ (`node scripts/validate-conversion.js`) before trusting the
// converter on any document nobody has read.
const fs = require('fs'); const path = require('path');
const { extractStructure } = require('./lib/docxStructure');
const { convertDoc } = require('./lib/convertDoc');
const ROOT = path.join(__dirname, '..');
const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).files;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'diet-data/index.json'), 'utf8'));

// Ground truth: the two hand-transcribed, hand-verified files. If the
// converter reproduces their structure, the same rules can be trusted on the
// documents nobody has read.
(async () => {
  // Only the two hand-transcribed files are ground truth. Every other entry in
  // index.json was written by this same converter, so comparing against it
  // would just be the converter agreeing with itself.
  const HAND_VERIFIED = ['94248269aabd', '389826545b24'];
  for (const id of HAND_VERIFIED) {
    const file = index[id];
    const entry = files.find((f) => f.id === id);
    const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'diet-data', file), 'utf8'));
    const { blocks } = await extractStructure(path.join(ROOT, 'content', entry.relPath));
    const got = convertDoc(blocks, entry);

    console.log('\n======== ' + file);
    console.log('mealPlans: truth ' + truth.mealPlans.length + ' / got ' + got.mealPlans.length);
    truth.mealPlans.forEach((p, i) => {
      const g = got.mealPlans[i];
      console.log('   [' + i + '] title ' + JSON.stringify(p.title) + ' vs ' + JSON.stringify(g && g.title)
        + ' | rows ' + p.rows.length + '/' + (g ? g.rows.length : '-')
        + ' | cols ' + JSON.stringify(p.columns) + ' vs ' + JSON.stringify(g && g.columns));
    });
    const tNames = truth.recipeGroups.flatMap((g) => (g.recipes || []).map((r) => r.name));
    const gNames = got.recipeGroups.flatMap((g) => (g.recipes || []).map((r) => r.name));
    console.log('groups truth: ' + truth.recipeGroups.map(g=>g.heading+'('+(g.recipes||[]).length+')').join(' | '));
    console.log('groups got  : ' + got.recipeGroups.map(g=>g.heading+'('+(g.recipes||[]).length+')').join(' | '));
    console.log('recipes truth ' + tNames.length + ' / got ' + gNames.length);
    console.log('  only in truth: ' + JSON.stringify(tNames.filter(n => !gNames.some(m => m.toLowerCase().startsWith(n.toLowerCase().slice(0,14))))));
    console.log('  only in got  : ' + JSON.stringify(gNames.filter(n => !tNames.some(m => m.toLowerCase().startsWith(n.toLowerCase().slice(0,14))))));
  }
})();
