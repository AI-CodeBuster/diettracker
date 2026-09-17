// Converts every .docx in manifest.json into diet-data JSON, stages the
// deduplicated recipe images for upload, and writes a review report.
//
//   node scripts/migrate-all.js            # convert everything
//   node scripts/migrate-all.js --dry-run  # report only, write nothing
//
// Reliability is split down the middle and the output says so: meal-plan and
// info tables come across verbatim (scored 100% against the hand-verified
// files), while recipes are a machine draft — every generated file carries
// meta.recipesReviewed = false, and the viewer shows a banner while it is.
// See scripts/lib/convertDoc.js for why recipes can't be fully automated.
//
// The two hand-transcribed files are never overwritten; they are only
// re-pointed at the content-addressed image paths and marked reviewed.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractStructure } = require('./lib/docxStructure');
const { convertDoc } = require('./lib/convertDoc');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const DATA_DIR = path.join(ROOT, 'diet-data');
const STAGE_DIR = path.join(ROOT, 'diet-images-staging');
const DRY = process.argv.includes('--dry-run');

// Files transcribed and verified by hand — regenerating them would throw that
// work away, so they are preserved and only their image paths are updated.
const HAND_VERIFIED = new Set(['94248269aabd', '389826545b24']);

// server/content holds two pairs of near-duplicate files ("...(1).docx" copies
// that are NOT byte-identical), and their condition/gear/diet/language tuples
// are the same — so the descriptive slug alone would have one silently
// overwrite the other. On collision the manifest id is appended, keeping both.
const usedSlugs = new Set();
function slugFor(entry) {
  const parts = [entry.condition, entry.comorbid, `gear${entry.gear}`, entry.dietType, entry.language];
  const base = parts.filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let slug = `${base}.json`;
  if (usedSlugs.has(slug)) slug = `${base}-${entry.id}.json`;
  usedSlugs.add(slug);
  return slug;
}

function extOf(name) {
  const m = /\.(jpe?g|png|gif|bmp|tiff?|emf|wmf)$/i.exec(name);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

// Images repeat heavily across conditions and languages — 1868 references
// resolve to a few hundred distinct files — so they are stored content
// addressed: identical bytes upload once and every document points at the
// same object.
const imageStore = new Map(); // sha1 -> { name, buf }
async function registerImage(zipEntry, mediaName) {
  const buf = await zipEntry.async('nodebuffer');
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const name = `${hash}.${extOf(mediaName)}`;
  if (!imageStore.has(hash)) imageStore.set(hash, { name, buf });
  return imageStore.get(hash).name;
}

// A "Dinner Recipe" group (Gear 4) carries no `recipes` of its own — Kanji /
// Thuvaiyal Recipes for Kanji / Millet Recipe are nested one level down in
// `subGroups` instead (see scripts/lib/convertDoc.js and diet-data/schema.md).
// Every place below that walks recipeGroups to resolve images or count
// recipes has to descend into that one extra level too, or those recipes
// silently keep their raw internal `images`/`startBlock` fields and never
// get a real image path.
function* allRecipes(groups) {
  for (const group of groups) {
    for (const r of group.recipes || []) yield r;
    for (const sub of group.subGroups || []) {
      for (const r of sub.recipes || []) yield r;
    }
  }
}

async function run() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const index = {};
  const report = [];

  for (const entry of manifest.files) {
    const docxPath = path.join(CONTENT_DIR, entry.relPath);
    const { blocks, media, zip } = await extractStructure(docxPath);

    // Register every image this document embeds, so a recipe's media name can
    // be resolved to its content-addressed filename.
    const mediaNames = {};
    for (const [mediaName, zipEntry] of Object.entries(media)) {
      mediaNames[mediaName] = await registerImage(zipEntry, mediaName);
    }

    const slug = slugFor(entry);
    const outPath = path.join(DATA_DIR, slug);
    let data;

    if (HAND_VERIFIED.has(entry.id)) {
      if (!fs.existsSync(outPath)) throw new Error(`hand-verified file missing: ${outPath}`);
      const current = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      current.meta.recipesReviewed = true;
      // Re-point its per-document image paths at the shared content-addressed
      // store, so every document — hand-made or generated — reads images the
      // same way and identical photos are stored once.
      for (const r of allRecipes(current.recipeGroups)) {
        if (!r.image) continue;
        const localName = r.image.split('/').pop();
        const localPath = path.join(DATA_DIR, 'images', entry.id, localName);
        if (!fs.existsSync(localPath)) continue;
        const buf = fs.readFileSync(localPath);
        const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
        const name = `${hash}.${extOf(localName)}`;
        if (!imageStore.has(hash)) imageStore.set(hash, { name, buf });
        r.image = `/api/diet-image/${name}`;
      }
      data = current;
      report.push({ id: entry.id, slug, handVerified: true, mealPlans: data.mealPlans.length,
        recipes: [...allRecipes(data.recipeGroups)].length, warnings: [] });
    } else {
      data = convertDoc(blocks, entry);
      // resolve each recipe's first image to its stored name — same cleanup
      // applied to generalGuidelines' recipes below, since it's produced by
      // the exact same groupRecipes()/findRecipes() pipeline and can carry
      // the same raw `images`/`startBlock` fields.
      const resolveRecipeImages = (groups) => {
        for (const r of allRecipes(groups)) {
          const first = (r.images || [])[0];
          if (first && mediaNames[first]) r.image = `/api/diet-image/${mediaNames[first]}`;
          delete r.images;
          delete r.startBlock;
          if (!r.ingredients || !r.ingredients.length) delete r.ingredients;
          if (!r.steps || !r.steps.length) delete r.steps;
        }
      };
      // A freeText-only group (Gear 3's Category 2/3, Cutting Types, Shop
      // Organic Products, Salad Law, Water Law) has no recipe of its own to
      // carry a photo — its own `images` (see convertDoc.js's groupRecipes)
      // resolves the same way, straight onto the group itself. Salad Law and
      // Water Law never have one anywhere in the 22 English Gear 3 documents
      // checked — left for build-recipe-library.js's fuzzy-match backfill,
      // once the full cross-corpus recipe library exists to match against.
      const resolveGroupImages = (groups) => {
        for (const group of groups) {
          if (group.images) {
            const first = group.images[0];
            if (first && mediaNames[first]) group.image = `/api/diet-image/${mediaNames[first]}`;
            delete group.images;
          }
        }
      };
      resolveRecipeImages(data.recipeGroups);
      resolveGroupImages(data.recipeGroups);
      if (!data.infoTables.length) delete data.infoTables;
      if (!data.notes.length) delete data.notes;
      if (data.generalGuidelines) {
        resolveRecipeImages(data.generalGuidelines.recipeGroups);
        resolveGroupImages(data.generalGuidelines.recipeGroups);
        if (!data.generalGuidelines.mealPlans.length) delete data.generalGuidelines.mealPlans;
        if (!data.generalGuidelines.infoTables.length) delete data.generalGuidelines.infoTables;
        if (!data.generalGuidelines.notes.length) delete data.generalGuidelines.notes;
        if (!data.generalGuidelines.recipeGroups.length) delete data.generalGuidelines.recipeGroups;
      }
      const recipeCount = [...allRecipes(data.recipeGroups)].length;
      report.push({
        id: entry.id, slug, handVerified: false,
        condition: entry.condition, comorbid: entry.comorbid, gear: entry.gear,
        dietType: entry.dietType, language: entry.language,
        mealPlans: data.mealPlans.length,
        infoTables: (data.infoTables || []).length,
        recipes: recipeCount,
        groups: data.recipeGroups.map((g) => g.heading),
        // Flags worth a human's eye before this file is trusted.
        warnings: [
          data.mealPlans.length === 0 ? 'no day-table found' : null,
          recipeCount === 0 ? 'no recipes extracted' : null,
          !data.meta.tagline ? 'no tagline' : null,
          // Every Gear 4 document checked so far (92/92) carries this
          // section — its absence on a new one is worth a human glance
          // rather than silently shipping a gear with no general guidance.
          entry.gear === 4 && !data.generalGuidelines ? 'no Gear 5 general guidelines found' : null,
        ].filter(Boolean),
      });
    }

    index[entry.id] = slug;
    if (!DRY) fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  }

  if (!DRY) {
    fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    fs.mkdirSync(STAGE_DIR, { recursive: true });
    for (const { name, buf } of imageStore.values()) {
      fs.writeFileSync(path.join(STAGE_DIR, name), buf);
    }
    fs.writeFileSync(path.join(ROOT, 'migration-report.json'), JSON.stringify(report, null, 2) + '\n');
  }

  const totalBytes = [...imageStore.values()].reduce((n, i) => n + i.buf.length, 0);
  const withWarnings = report.filter((r) => (r.warnings || []).length);
  console.log(`documents converted : ${report.length} (${report.filter(r => r.handVerified).length} hand-verified, preserved)`);
  console.log(`meal-plan tables    : ${report.reduce((n, r) => n + r.mealPlans, 0)}`);
  console.log(`info tables         : ${report.reduce((n, r) => n + (r.infoTables || 0), 0)}`);
  console.log(`draft recipes       : ${report.reduce((n, r) => n + r.recipes, 0)}`);
  console.log(`unique images       : ${imageStore.size} (${(totalBytes / 1e6).toFixed(1)} MB) staged in diet-images-staging/`);
  console.log(`files with warnings : ${withWarnings.length}`);
  for (const r of withWarnings.slice(0, 15)) console.log(`   ${r.slug}: ${r.warnings.join(', ')}`);
  if (withWarnings.length > 15) console.log(`   ... ${withWarnings.length - 15} more (see migration-report.json)`);
  if (DRY) console.log('\n(dry run — nothing written)');
}

run().catch((e) => { console.error(e); process.exit(1); });
