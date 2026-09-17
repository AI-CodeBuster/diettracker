// Builds a single cross-condition recipe library from the 134 per-combo
// `diet-data/*.json` files migrate-all.js already produces, and backfills a
// `recipe_id` onto every recipe object in those files pointing into it.
//
// Why a second pass rather than doing this inside migrate-all.js: recipe
// identity here is defined by CONTENT (a sha1 of its normalized name +
// ingredients + steps — the same content-addressing migrate-all.js already
// uses for images), and the same recipe genuinely recurs across many source
// documents (a kidney-safe salad dressing shows up in several kidney files;
// a herbal tea option repeats across nearly every condition). Deduping that
// requires seeing every file at once, which a per-file converter pass can't.
//
// Existing per-file fields (name/ingredients/steps/image/...) are left
// exactly as they are — `recipe_id` is additive, so nothing already reading
// a diet-data file's inline recipe content breaks.
//
//   node scripts/build-recipe-library.js            # build + backfill
//   node scripts/build-recipe-library.js --dry-run   # report only
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { categoriesMentionedIn } = require('../lib/foodRules');
const { findBestImageMatchByContainment } = require('../lib/nameMatch');

// A freeText-only group (Salad Law, Water Law — see convertDoc.js's
// groupRecipes) has no image of its own in ANY of the 22 English Gear 3
// documents checked; it's a guideline section, not a dish, so there was
// never going to be a source photo for it the way there is for Category 2/3
// or Cutting Types (which DO have one, resolved already in migrate-all.js).
// Backfilled here, once the full cross-corpus recipe library exists to
// match against, via findBestImageMatchByContainment (not the plain
// name-vs-name findBestImageMatch server/index.js uses for AI suggestions —
// see that function's own comment in nameMatch.js for why a long guideline
// paragraph needs the other scoring formula). A containment score of 0.3
// means at least 30% of the SHORTER side's meaningful words (almost always
// the recipe name's own words, once STOPWORDS strips the paragraph down)
// are present in the other — one real shared word out of a 2-4 word dish
// name routinely clears this.
const GROUP_IMAGE_MATCH_THRESHOLD = 0.3;

// Water Law's fuzzy match (a Herbal Tea recipe photo, via its own text
// mentioning "detox tea" — see the containment-match comment above) was a
// reasonable stand-in given nothing in the corpus is literally a photo of
// water, but the user asked for an actual glass-of-water image instead. A
// purpose-made illustration (server/scripts/lib — generated via Pillow, not
// pulled from any source document) was uploaded once, by hand, into the same
// content-addressed store every other diet image lives in (see git history /
// project_gear_based_diet_generation.md for how — the upload script itself
// was a throwaway one-off, not kept). Listed here, keyed by group heading,
// so this survives a future migrate-all.js + build-recipe-library.js re-run
// instead of silently reverting to the fuzzy tea-photo match the moment
// backfillGroupImages runs again with a clean slate.
// The Tamil "Fruits" (Law) group's own fuzzy match landed on a food dish —
// completely unrelated to fruit — in all 27 Tamil Gear 4 documents (every
// condition, plain and Gastric-comorbid alike); the 25 English ones matched
// fine and are left untouched. Rather than debug why the Tamil freeText
// scores that dish highest, reuse the real fruit-basket photo Diabetes
// Gear 2's own "Fruits" recipe card already carries from its source
// document — a genuine photo of fruit is the correct illustration for
// every language/condition's fruit-law guidance, not something specific to
// Diabetes. See git history for the one-off script that hand-patched the
// 27 already-generated files directly (this entry only prevents the same
// mismatch from coming back on a future re-migration).
const GROUP_IMAGE_OVERRIDES = {
  'Water Law': '/api/diet-image/e5a60ab9fb0913d5.png',
  'Fruits': '/api/diet-image/064d664e3167e3bb.jpg',
};

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'diet-data');
const OUT_FILE = path.join(DATA_DIR, 'recipe-library.json');
const DRY = process.argv.includes('--dry-run');

// A gear's document holds exactly one meal — same rule as
// client/src/lib/gearChain.js's GEAR_MEAL_LABELS, mirrored here since this
// is a plain Node script (no bundler to share the client module through).
const MEAL_BY_GEAR = { 2: 'breakfast', 3: 'lunch', 4: 'dinner' };

function normalizeForHash(recipe) {
  const parts = [
    (recipe.name || '').trim(),
    ...(recipe.ingredients || []),
    ...(recipe.steps || []),
  ];
  return parts.join('|').toLowerCase().replace(/\s+/g, ' ').trim();
}

function recipeId(recipe) {
  return crypto.createHash('sha1').update(normalizeForHash(recipe)).digest('hex').slice(0, 16);
}

// Walks every recipe in a diet-data document, main content and general
// guidelines alike, calling back with (recipe, mealType) — 'general' for
// generalGuidelines' recipes, since that content isn't tied to one meal. A
// group like Gear 4's "Dinner Recipe" carries no `recipes` of its own — Kanji
// / Thuvaiyal Recipes for Kanji / Millet Recipe are nested one level down in
// `subGroups` instead (see scripts/lib/convertDoc.js and diet-data/schema.md)
// — so every group is walked through this same helper rather than reading
// `group.recipes` directly, or those recipes would silently never make it
// into the library at all.
function recipesOfGroup(group) {
  const own = group.recipes || [];
  const nested = (group.subGroups || []).flatMap((sub) => sub.recipes || []);
  return [...own, ...nested];
}
function forEachRecipe(data, cb) {
  for (const group of data.recipeGroups || []) {
    for (const r of recipesOfGroup(group)) cb(r, MEAL_BY_GEAR[data.meta.gear] || null);
  }
  if (data.generalGuidelines) {
    for (const group of data.generalGuidelines.recipeGroups || []) {
      for (const r of recipesOfGroup(group)) cb(r, 'general');
    }
  }
}

function run() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'recipe-library.json');

  const library = new Map(); // recipe_id -> entry
  const fileData = new Map(); // filename -> parsed data (kept in memory to backfill after the full scan)

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    fileData.set(file, data);
    const { condition, comorbid, dietType, language } = data.meta;
    const reviewed = data.meta.recipesReviewed !== false; // absent counts as reviewed, matching schema.md

    forEachRecipe(data, (r, mealType) => {
      const id = recipeId(r);
      r.recipe_id = id; // backfilled onto the file's own copy, written back below

      let entry = library.get(id);
      if (!entry) {
        entry = {
          recipe_id: id,
          name: r.name,
          ingredients: r.ingredients,
          steps: r.steps,
          note: r.note,
          image: r.image,
          language,
          mealTypes: new Set(),
          conditions: new Set(),
          dietTypes: new Set(),
          reviewed: false,
          allergens: categoriesMentionedIn([r.name, ...(r.ingredients || [])].join(' ')),
          sourceCount: 0,
        };
        library.set(id, entry);
      }
      // Identical text recurring across files widens who it's eligible
      // for — this is the whole point of a cross-condition library rather
      // than one recipe list per file.
      if (mealType) entry.mealTypes.add(mealType);
      entry.conditions.add(comorbid ? `${condition}+${comorbid}` : condition);
      entry.dietTypes.add(dietType);
      entry.reviewed = entry.reviewed || reviewed;
      entry.sourceCount += 1;
      if (!entry.image && r.image) entry.image = r.image;
    });
  }

  const libraryArray = [...library.values()].map((e) => ({
    ...e,
    mealTypes: [...e.mealTypes],
    conditions: [...e.conditions],
    dietTypes: [...e.dietTypes],
  }));

  const byReviewed = libraryArray.filter((e) => e.reviewed).length;
  const byAllergen = libraryArray.filter((e) => e.allergens.length).length;
  const dupes = libraryArray.filter((e) => e.sourceCount > 1).length;
  console.log(`recipes across ${files.length} files: ${[...fileData.values()].reduce((n, d) => { let c = 0; forEachRecipe(d, () => c++); return n + c; }, 0)}`);
  console.log(`unique recipes in library: ${libraryArray.length} (${dupes} appear in more than one file)`);
  console.log(`reviewed: ${byReviewed} / ${libraryArray.length}`);
  console.log(`auto-tagged with at least one allergen category: ${byAllergen}`);

  // Backfill a photo for any freeText-only group (Salad Law, Water Law —
  // Category 2/3, Cutting Types and Shop Organic Products already got their
  // own real one directly in migrate-all.js) by fuzzy-matching against every
  // recipe in the library that DOES have a photo. Only now possible because
  // the library — built from ALL 134 files — didn't exist yet during
  // migrate-all.js's own single-file-at-a-time pass. Matches on the group's
  // FULL freeText (heading + body), not just the heading alone — "Water
  // Law"'s own two words share nothing with any recipe name in the corpus
  // (nothing is literally named "water"), but its guideline text mentions
  // "detox tea", which — once STOPWORDS strips the surrounding filler words
  // down to the handful that actually carry meaning — is enough to find a
  // real Herbal Tea recipe's photo as a reasonable stand-in.
  let groupImagesBackfilled = 0;
  const backfillGroupImages = (groups) => {
    if (!groups) return;
    for (const group of groups) {
      // "freeText-ONLY" is the actual rule, and a group that owns recipe
      // cards is excluded by it: each card already carries its own photo, so
      // a group-level one is the redundant second image schema.md warns
      // about on Category 1. Testing only for `freeText` used to be enough
      // because no group had both — but Gear 2's "Recipes" and "Herbal Tea"
      // do (Salad Laws / the tea Important Notes), and without this a rerun
      // would silently re-add the group photos those two were just cleared
      // of, straight back into diet-data (this pass writes the files).
      if (!group.freeText || group.image) continue;
      if ((group.recipes && group.recipes.length) || (group.subGroups && group.subGroups.length)) continue;
      if (GROUP_IMAGE_OVERRIDES[group.heading]) { group.image = GROUP_IMAGE_OVERRIDES[group.heading]; groupImagesBackfilled += 1; continue; }
      const query = group.freeText.join(' ');
      const image = findBestImageMatchByContainment(query, libraryArray, GROUP_IMAGE_MATCH_THRESHOLD);
      if (image) { group.image = image; groupImagesBackfilled += 1; }
    }
  };
  for (const data of fileData.values()) {
    backfillGroupImages(data.recipeGroups);
    if (data.generalGuidelines) backfillGroupImages(data.generalGuidelines.recipeGroups);
  }
  console.log(`freeText group photos backfilled by fuzzy match: ${groupImagesBackfilled}`);

  if (!DRY) {
    fs.writeFileSync(OUT_FILE, JSON.stringify(libraryArray, null, 2) + '\n');
    for (const [file, data] of fileData) {
      fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + '\n');
    }
    console.log(`wrote ${OUT_FILE} and backfilled recipe_id into ${fileData.size} files`);
  } else {
    console.log('(dry run — nothing written)');
  }
}

run();
