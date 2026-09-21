require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { normalizeSheet } = require('./lib/sheetSchema');
const { foodRules, findRuleForTerm, categoriesMentionedIn } = require('./lib/foodRules');
const { readOverrides, writeGearOverride, isSafeKey } = require('./lib/patientStore');
const { listAllStatuses, getStatusesForPerson, setStatus, clearStatus, STATUSES: PATIENT_STATUSES } = require('./lib/patientStatusStore');
const { recordWeightIfChanged, listWeightHistory } = require('./lib/weightLogStore');
const { patientKey } = require('./lib/patientKey');
const { parseWeightKg } = require('./lib/bmi');
const { extractSpreadsheetId, ID_PATTERN: SPREADSHEET_ID_PATTERN } = require('./lib/spreadsheetId');
const { applyReplacementsToDocx } = require('./lib/docxReplace');
const { stripCoverPage } = require('./lib/docxCoverPage');
const { requireAuth } = require('./lib/requireAuth');
const { supabaseAdmin } = require('./lib/supabaseAdmin');
const { suggestAlternativesViaAI } = require('./lib/geminiSuggest');
const { listIssues, createIssue, updateIssueStatus, KINDS: ISSUE_KINDS, URGENCIES: ISSUE_URGENCIES } = require('./lib/issuesStore');
const {
  listRequirements,
  createRequirement,
  updateRequirementStatus,
  PRIORITIES: REQUIREMENT_PRIORITIES,
} = require('./lib/requirementsStore');
const { getUserRole, requireDeveloper, requireTL } = require('./lib/roles');
const { listRemarksForPatient, listAllRemarks, createRemark, resolveRemark, rekeyRemark, deleteRemark } = require('./lib/dietRemarksStore');
const { listTeam, setRole } = require('./lib/teamStore');
const { writeTLVerification, DIET_ACCURACY_VALUES, DIET_QUALITY_VALUES } = require('./lib/tlVerificationWriter');
const { writePrepStatus } = require('./lib/prepStatusWriter');
const { logEffort, todaysCountsByPerson, latestPreparedAt } = require('./lib/effortLogStore');
const { listPatientActivity } = require('./lib/patientActivityStore');
const { findEligibleRecipes } = require('./lib/recipeEligibility');
const { readRecipeOverrides, writeRecipeOverride } = require('./lib/recipeOverrideStore');
const { readScheduleOverrides, writeScheduleOverride } = require('./lib/scheduleOverrideStore');
const { listManualRecipes, saveManualRecipe } = require('./lib/manualRecipeStore');
const { getPatientDetailFields, savePatientDetailFields, ALL_FIELD_KEYS: ALL_PATIENT_DETAIL_FIELD_KEYS, CATEGORY_KEYS: PATIENT_DETAIL_FIELD_CATEGORIES } = require('./lib/patientDetailFieldsStore');
const { suggestRecipeViaAI } = require('./lib/geminiRecipeSuggest');
const { detectConditions } = require('./lib/conditionMatch');
const { findBestImageMatch } = require('./lib/nameMatch');
const { toCSV } = require('./lib/csv');
const {
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  exportHeaders,
  exportRows,
  bulkImportStudents,
} = require('./lib/studentsStore');

const CONTENT_BUCKET = 'diet-content';

const app = express();
const PORT = process.env.PORT || 4000;
// Default express.json() caps at 100kb — far too small for the manual
// recipe-image upload (POST /api/diet-image/upload sends the file as a
// base64 JSON string). Raised globally rather than per-route since Express
// only reads the body once — a second, differently-configured json() on
// just that route never gets a turn.
app.use(express.json({ limit: '12mb' }));

// Every API route requires a signed-in Supabase admin — the frontend login
// screen is otherwise just cosmetic since these endpoints serve patient data.
app.use('/api', requireAuth);

const sheetsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'sheets.config.json'), 'utf-8'));
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// ---- in-memory cache for sheet fetches (Google Sheets is the source of truth; we just avoid hammering it) ----
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // name -> { at, data }

async function fetchSheetCSV(sheetName, { bustCache, spreadsheetId } = {}) {
  const sid = spreadsheetId || sheetsConfig.spreadsheetId;
  let url = `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  // Google's own edge can serve a briefly-stale cached response for the
  // exact same URL. A unique query param defeats that on a manual sync, so
  // "Sync now" always reflects the current sheet content, not a cached edge.
  if (bustCache) url += `&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch sheet "${sheetName}": ${res.status}`);
  return res.text();
}

app.get('/api/sheets', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(sheetsConfig.sheets);
});

// Lists the tabs of an arbitrary public spreadsheet, via the Google Sheets
// API (the CSV export this app otherwise uses has no "list tabs" endpoint —
// it can only fetch one already-named tab at a time). A distinct literal
// path rather than nesting under /api/sheets/:name, so Express route order
// can never make ":name" swallow this as a sheet name.
app.get('/api/spreadsheet-tabs', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const spreadsheetId = extractSpreadsheetId(req.query.spreadsheetId);
  if (!spreadsheetId) return res.status(400).json({ error: 'Invalid spreadsheet link' });
  if (!process.env.GOOGLE_SHEETS_API_KEY) {
    return res.status(503).json({ error: 'Google Sheets API key not configured — ask your developer to set GOOGLE_SHEETS_API_KEY in server/.env' });
  }
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${process.env.GOOGLE_SHEETS_API_KEY}&fields=properties.title,sheets.properties.title`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      if (r.status === 403) throw new Error("This spreadsheet isn't shared as \"Anyone with the link can view\" — ask the owner to share it, then try again.");
      if (r.status === 404) throw new Error('Spreadsheet not found — check the link.');
      throw new Error(body?.error?.message || `Google Sheets API returned ${r.status}`);
    }
    const data = await r.json();
    res.json({
      spreadsheetId,
      title: data.properties?.title || 'Untitled spreadsheet',
      sheets: (data.sheets || []).map((s) => ({ name: s.properties.title, label: s.properties.title })),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get('/api/sheets/:name', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { name } = req.params;
  const rawSpreadsheetId = req.query.spreadsheetId;
  let spreadsheetId = null;
  if (rawSpreadsheetId) {
    if (!SPREADSHEET_ID_PATTERN.test(rawSpreadsheetId)) return res.status(400).json({ error: 'Invalid spreadsheet id' });
    spreadsheetId = rawSpreadsheetId;
  } else {
    const configured = sheetsConfig.sheets.find((s) => s.name === name);
    if (!configured) return res.status(404).json({ error: `Unknown sheet "${name}"` });
  }

  const cacheKey = `${spreadsheetId || 'default'}:${name}`;
  const force = req.query.refresh === '1';
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const csvText = await fetchSheetCSV(name, { bustCache: force, spreadsheetId });
    const normalized = normalizeSheet(csvText);
    const payload = { sheet: name, fetchedAt: new Date().toISOString(), ...normalized };
    cache.set(cacheKey, { at: Date.now(), data: payload });
    res.json({ ...payload, cached: false });

    // Best-effort weight-history capture, after the response is already
    // sent — a Supabase hiccup here should never slow down or break sheet
    // loading. Only runs on an actual sheet fetch (not a served-from-cache
    // response), so it can't fire more often than the 30s cache allows.
    // Skipped entirely for a custom spreadsheet: patientKey is derived from
    // Student ID, and an unrelated spreadsheet could easily reuse an ID
    // that belongs to a real patient in the default tracker — writing
    // weight history under that key would corrupt their real record.
    if (!spreadsheetId && normalized.isPersonSheet) {
      for (const person of normalized.rows) {
        const weightKg = parseWeightKg(person.weight);
        if (weightKg == null) continue;
        recordWeightIfChanged(patientKey(name, person), weightKg).catch((err) => {
          console.error(`Failed to record weight for ${person.name}:`, err);
        });
      }
    }
  } catch (err) {
    if (cached) return res.json({ ...cached.data, cached: true, staleError: String(err) });
    res.status(502).json({ error: String(err) });
  }
});

app.get('/api/manifest', (req, res) => {
  if (!fs.existsSync(MANIFEST_PATH)) return res.status(500).json({ error: 'manifest.json not built yet' });
  res.sendFile(MANIFEST_PATH);
});

let manifestFiles = [];
function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    manifestFiles = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')).files;
  }
}
loadManifest();

// The new data-driven diet-plan format (see server/diet-data/schema.md) —
// migrated one manifest entry at a time. DIET_DATA_INDEX maps a manifest
// entry's id to its data file, exactly like manifestFiles maps an id to a
// .docx; a gear with no entry here just isn't migrated yet, and the client
// falls back to the existing .docx viewer for it. Unlike the .docx
// templates (15-20MB, served from Supabase Storage — see
// downloadTemplate/redirectToSignedUrl above), these are small JSON files
// bundled with the deployment like manifest.json itself, so they're read
// straight off disk with no storage round-trip.
const DIET_DATA_DIR = path.join(__dirname, 'diet-data');
let dietDataIndex = {};
function loadDietDataIndex() {
  const indexPath = path.join(DIET_DATA_DIR, 'index.json');
  dietDataIndex = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf-8')) : {};
}
loadDietDataIndex();

app.get('/api/diet-template/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fileName = dietDataIndex[req.params.id];
  if (!fileName) return res.status(404).json({ error: 'Not migrated to the data-driven format yet' });
  const filePath = path.join(DIET_DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Data file missing on disk' });
  res.sendFile(filePath);
});

// Recipe photos for the data-driven format. These are CONTENT ADDRESSED —
// the filename is a hash of the bytes (see scripts/migrate-all.js) — because
// the 111 source documents reference the same few hundred photos over and
// over: 1868 references resolve to ~300 distinct images, 845MB down to 115MB.
// A recipe's `image` is therefore just /api/diet-image/<hash>.<ext>, with no
// document id in it, and two documents sharing a photo share the object.
//
// Served from local staging when it exists (developer machines, right after
// running the migration) and from Storage otherwise — a Vercel function's
// filesystem is read-only and far too small to carry 115MB of photos, the
// same reason the .docx templates live in Storage.
//
// :file flows into both a filesystem path and a storage key, so it is
// constrained to exactly the shape migrate-all.js emits.
const DIET_IMAGE_NAME_PATTERN = /^[0-9a-f]{16}\.(jpg|png|gif)$/;
const DIET_IMAGE_BUCKET = 'diet-images';
const DIET_IMAGE_STAGE_DIR = path.join(__dirname, 'diet-images-staging');
app.get('/api/diet-image/:file', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (!DIET_IMAGE_NAME_PATTERN.test(req.params.file)) return res.status(400).json({ error: 'Invalid image name' });
  const localPath = path.join(DIET_IMAGE_STAGE_DIR, req.params.file);
  if (fs.existsSync(localPath)) return res.sendFile(localPath);
  const { data, error } = await supabaseAdmin.storage
    .from(DIET_IMAGE_BUCKET)
    .createSignedUrl(req.params.file, 3600);
  if (error || !data) return res.status(404).json({ error: 'Image not found' });
  res.redirect(data.signedUrl);
});

const DIET_IMAGE_CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
const DIET_IMAGE_MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
let diskImageBucketReady = null; // null = not checked yet; a Promise once a check/create is in flight, shared across concurrent uploads
function ensureDietImageBucket() {
  if (!diskImageBucketReady) {
    diskImageBucketReady = supabaseAdmin.storage.getBucket(DIET_IMAGE_BUCKET).then(({ error }) => {
      if (!error) return;
      // Same privacy requirement as sync-diet-images-to-storage.js: these
      // sit behind /api/diet-image's own auth-gated signed-URL redirect, so
      // the bucket itself must stay private.
      return supabaseAdmin.storage.createBucket(DIET_IMAGE_BUCKET, { public: false }).then(({ error: createErr }) => {
        if (createErr) throw new Error(`Could not create bucket "${DIET_IMAGE_BUCKET}": ${createErr.message}`);
      });
    });
  }
  return diskImageBucketReady;
}

// Manual recipe entry (client/src/components/RecipeReplaceModal.jsx's
// "Enter manually" tab) needs to store a dietitian-supplied photo the same
// content-addressed way every other recipe image already works — so the
// picker, the print view and everything else that reads `recipe.image` never
// needs to know whether a photo came from a source .docx or was uploaded
// here. Sent as a base64 data URL in JSON (see the raised express.json()
// limit above) rather than multipart, since no multipart-parsing dependency
// is otherwise needed anywhere in this app.
app.post('/api/diet-image/upload', async (req, res) => {
  const { dataUrl } = req.body || {};
  const match = typeof dataUrl === 'string' && /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return res.status(400).json({ error: 'Expected a data:image/...;base64,... string' });
  const ext = DIET_IMAGE_MIME_TO_EXT[match[1]];
  if (!ext) return res.status(400).json({ error: `Unsupported image type: ${match[1]}` });

  let buf;
  try { buf = Buffer.from(match[2], 'base64'); } catch { return res.status(400).json({ error: 'Invalid base64 image data' }); }
  if (!buf.length || buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 8MB' });

  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const name = `${hash}.${ext}`;

  try {
    fs.mkdirSync(DIET_IMAGE_STAGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIET_IMAGE_STAGE_DIR, name), buf);
    await ensureDietImageBucket();
    const { error } = await supabaseAdmin.storage.from(DIET_IMAGE_BUCKET).upload(name, buf, {
      contentType: DIET_IMAGE_CONTENT_TYPES[ext],
      upsert: true,
    });
    // A Storage failure isn't fatal here — the local copy just written
    // already lets /api/diet-image serve it on THIS machine immediately;
    // only a later production deploy (no local staging) would need the
    // Storage copy to actually exist, which sync-diet-images-to-storage.js
    // can always re-upload from a rebuilt local staging dir if this
    // particular request's cloud upload failed.
    if (error) console.error(`Cloud upload failed for ${name} (served locally regardless):`, error.message);
  } catch (err) {
    return res.status(500).json({ error: `Could not save image: ${err.message}` });
  }

  res.json({ image: `/api/diet-image/${name}` });
});

// The cross-condition recipe library (server/scripts/build-recipe-library.js)
// — every recipe across all migrated diet-plans, deduplicated by content and
// tagged with which meal/diet-type/condition/language it's appropriate for.
// Loaded once at startup like dietDataIndex above; re-run the build script
// and restart the server to pick up changes (recipes don't change often
// enough to justify a live-reload path).
const RECIPE_LIBRARY_PATH = path.join(DIET_DATA_DIR, 'recipe-library.json');
let recipeLibrary = [];
function loadRecipeLibrary() {
  recipeLibrary = fs.existsSync(RECIPE_LIBRARY_PATH)
    ? JSON.parse(fs.readFileSync(RECIPE_LIBRARY_PATH, 'utf-8'))
    : [];
}
loadRecipeLibrary();

// Powers the [Replace Recipe] picker: given the meal slot being replaced and
// the patient's own profile fields (sent directly from the person object the
// client already has in memory — see client/src/components/
// RecipeReplaceModal.jsx — rather than this route re-deriving them from a
// second sheet lookup), returns eligible alternatives ranked by
// reviewed-first, dislike-avoiding-first. Every filter/rank rule lives in
// lib/recipeEligibility.js; this route is just the request/response shape.
app.get('/api/recipe-alternatives', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { mealType, dietType, conditionText, language, allergyText, dislikeText, excludeRecipeId, search, limit } = req.query;
  try {
    // Manually-entered recipes (manualRecipeStore.js) are merged in
    // alongside the static library on every request — that store is the
    // live, writable counterpart of the read-only-at-runtime library file,
    // so a recipe a coach typed in for one patient shows up here for every
    // other patient's eligible gear/condition from then on.
    const manualRecipes = await listManualRecipes();
    const result = findEligibleRecipes([...recipeLibrary, ...manualRecipes], {
      mealType: mealType || undefined,
      dietType: dietType || undefined,
      conditionText: conditionText || '',
      language: language || undefined,
      allergyText: allergyText || '',
      dislikeText: dislikeText || '',
      excludeRecipeId: excludeRecipeId || undefined,
      // Free-text browsing for the [Add Recipe] picker (server/lib/
      // recipeEligibility.js's own comment) — capped well above the default
      // so a broad browse isn't truncated to the replace-picker's usual 20.
      search: search || undefined,
      limit: limit ? Math.min(Number(limit), 60) : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to load recipe alternatives:', err);
    res.status(500).json({ error: 'Could not load recipe alternatives' });
  }
});

// One recipe's full content by id, for resolving a saved recipe-override's
// target — the client stores/loads only { originalRecipeId, newRecipeId }
// pairs (see recipeOverrideStore.js), never the full recipe, so this is what
// turns a saved id back into something GearViewer can actually render.
app.get('/api/recipe/:recipeId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const fromLibrary = recipeLibrary.find((r) => r.recipe_id === req.params.recipeId);
  if (fromLibrary) return res.json(fromLibrary);
  try {
    const manualRecipes = await listManualRecipes();
    const fromManual = manualRecipes.find((r) => r.recipe_id === req.params.recipeId);
    if (!fromManual) return res.status(404).json({ error: 'Recipe not found' });
    res.json(fromManual);
  } catch (err) {
    console.error('Failed to look up manual recipe:', err);
    res.status(500).json({ error: 'Could not load recipe' });
  }
});

// Promotes a recipe just typed into "Enter Manually" (RecipeReplaceModal.jsx/
// AddRecipeModal.jsx) into the shared cross-patient library (manualRecipeStore.js)
// — a SEPARATE, best-effort call from the one that actually applies it to the
// coach's current patient (PUT .../recipe-overrides, unchanged) — see this
// route's own client-side caller for why a failure here never blocks that.
// mealType/dietType are tagged directly from the gear/meal the coach had
// open; condition is detected server-side from the patient's own free-text
// notes, exactly like /api/recipe-alternatives, so the two routes can never
// disagree about what "this patient's condition" means.
const MANUAL_RECIPE_ID_RE = /^manual-[a-z0-9]+-[a-z0-9]+$/;
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner']);
const DIET_TYPES = new Set(['VEG', 'NONVEG', 'EGG']);
app.post('/api/manual-recipes', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { recipe, mealType, dietType, language, conditionText } = req.body || {};
  const valid = recipe && typeof recipe.recipe_id === 'string' && MANUAL_RECIPE_ID_RE.test(recipe.recipe_id)
    && isValidOverrideRecipe(recipe)
    && (!mealType || MEAL_TYPES.has(mealType))
    && (!dietType || DIET_TYPES.has(dietType));
  if (!valid) return res.status(400).json({ error: 'Invalid recipe' });
  try {
    const conditions = detectConditions(conditionText || '');
    const allergens = categoriesMentionedIn([recipe.name, ...(recipe.ingredients || [])].join(' '));
    const createdByName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone';
    const recipeId = await saveManualRecipe(recipe, { mealType, conditions, dietType, language, allergens, createdByName });
    res.json({ recipe_id: recipeId });
  } catch (err) {
    console.error('Failed to save manual recipe to library:', err);
    res.status(500).json({ error: 'Could not save recipe to library' });
  }
});

// Gemini generates the recipe TEXT; it does not generate or fetch a photo
// (an AI-generated food image risks looking edible but not actually
// matching real ingredients/preparation, which is a worse failure mode for
// patient-facing health content than simply having no photo). Instead, the
// suggested dish name is matched against the existing recipe library by
// word overlap (lib/nameMatch.js — shared with scripts/build-recipe-library.js,
// which uses the same matching to backfill a photo for a recipe whose OWN
// occurrences in the source corpus never had one at all), and that recipe's
// own real photo is reused when the match is close enough — the same
// "automatically attach an image" behavior the user asked for, without
// fabricating one.
const AI_IMAGE_MATCH_THRESHOLD = 0.5;
function findMatchingImage(name) {
  return findBestImageMatch(name, recipeLibrary, AI_IMAGE_MATCH_THRESHOLD);
}

// The [Replace Recipe] picker's "AI Suggestion" tab. Generates ONE
// alternative recipe via Gemini (lib/geminiRecipeSuggest.js) — considering
// the patient's condition(s), diet type, language, and (unlike the plain
// library search) actively avoiding their allergies at generation time, not
// just filtering after the fact. A generated recipe is content-hashed the
// same way every other recipe is, so it can be selected/saved/reverted
// through the exact same override machinery — but is marked `reviewed:
// false`, same caution as a machine-converted recipe, since nothing here
// has been checked by a dietitian.
app.post('/api/recipe-ai-suggestion', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { recipe, dietType, language, conditionText, mealType, allergyText, dislikeText } = req.body || {};
  if (!recipe || typeof recipe.name !== 'string') {
    return res.status(400).json({ error: 'recipe (with at least a name) is required' });
  }
  try {
    // Same free-text-in, detector-runs-server-side shape as
    // /api/recipe-alternatives above, so the two routes can never disagree
    // about what "the patient's condition" means.
    const suggestion = await suggestRecipeViaAI({
      recipe, dietType, language, mealType, allergyText, dislikeText,
      conditions: detectConditions(conditionText || ''),
    });
    const image = findMatchingImage(suggestion.name);
    const recipeId = crypto.createHash('sha1')
      .update([suggestion.name, ...suggestion.ingredients, ...suggestion.steps].join('|').toLowerCase().replace(/\s+/g, ' ').trim())
      .digest('hex').slice(0, 16);
    res.json({ recipe_id: recipeId, ...suggestion, image, reviewed: false, aiGenerated: true });
  } catch (err) {
    console.error('AI recipe suggestion failed:', err.message);
    // callGemini (lib/geminiClient.js) already retries a 503/429 a couple of
    // times on its own — reaching here with one of those means Gemini
    // stayed overloaded through the whole retry window, not that this one
    // request did anything wrong. Worth telling the dietitian that plainly
    // rather than surfacing Google's raw JSON error body, which reads like
    // something is broken in the app itself.
    const overloaded = /Gemini API returned (429|503)/.test(err.message);
    // A live check while diagnosing this exact complaint found the real API
    // occasionally NOT responding within the timeout at all under today's
    // load (no error, just slow) — reads as "aborted", not "overloaded", so
    // it needs its own friendly message rather than falling through to the
    // raw "This operation was aborted."
    const timedOut = err.name === 'AbortError' || /aborted/i.test(err.message);
    const message = overloaded
      ? 'Gemini is temporarily overloaded (already retried a few times) — please try again in a moment.'
      : timedOut
        ? 'Gemini took too long to respond — please try again.'
        : `Could not get an AI suggestion: ${err.message}`;
    res.status(502).json({ error: message });
  }
});

// entry.relPath is only ever looked up from our own manifest.json (never
// taken from the request), so it's a trusted storage key here.
async function downloadTemplate(relPath) {
  const { data, error } = await supabaseAdmin.storage.from(CONTENT_BUCKET).download(relPath);
  if (error || !data) throw new Error(error ? error.message : 'not found');
  return Buffer.from(await data.arrayBuffer());
}

// Redirects to a short-lived signed URL rather than streaming the file
// through this response: some of these charts are 15-20MB with embedded
// images, well past a serverless function's response-size limit. A signed
// URL lets the browser download straight from storage instead.
async function redirectToSignedUrl(res, relPath, downloadName) {
  const { data, error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .createSignedUrl(relPath, 60, downloadName ? { download: downloadName } : undefined);
  if (error || !data) return res.status(404).json({ error: 'File not found in storage' });
  res.redirect(data.signedUrl);
}

app.get('/api/diet-file/:id', async (req, res) => {
  const entry = manifestFiles.find((f) => f.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'File not found' });
  const downloadName = req.query.download === '1' ? entry.fileName : undefined;
  await redirectToSignedUrl(res, entry.relPath, downloadName);
});

// Serves this gear's file with its own cover page (patient questionnaire +
// table of contents) stripped out — for rendering as a continuation of an
// earlier gear's diet plan in the viewer (see DietViewerPanel's gear chain),
// never for download. Unlike the personalized-copy route below, this
// transform is the same for every request against a given template (no
// per-patient data involved), so it's worth actually caching: viewing Gear
// 2 fires this off twice in parallel (Gear 3 + Gear 4), each otherwise
// paying for a full download-transform-reupload round trip on a file that
// can be 15-20MB, on every single view.
//
// createSignedUrl itself fails for an object that doesn't exist, so it
// doubles as the "is this already generated" check — no separate list/stat
// call needed. The path is versioned so a future fix to docxCoverPage.js
// can force fresh output by bumping it, rather than needing to hunt down
// and delete stale generated copies.
const WITHOUT_COVER_VERSION = 'v3';
app.get('/api/diet-file/:id/without-cover', async (req, res) => {
  const entry = manifestFiles.find((f) => f.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'File not found' });

  const generatedPath = `_generated/without-cover-${WITHOUT_COVER_VERSION}_${entry.id}.docx`;

  const { data: cached } = await supabaseAdmin.storage.from(CONTENT_BUCKET).createSignedUrl(generatedPath, 60);
  if (cached) return res.redirect(cached.signedUrl);

  let originalBuf;
  try {
    originalBuf = await downloadTemplate(entry.relPath);
  } catch (err) {
    return res.status(404).json({ error: 'File not found in storage' });
  }

  let outBuf = originalBuf;
  try {
    outBuf = await stripCoverPage(originalBuf);
  } catch (err) {
    console.error(`Failed to strip cover page for ${entry.id}, serving unmodified file:`, err);
  }

  const { error: upErr } = await supabaseAdmin.storage.from(CONTENT_BUCKET).upload(generatedPath, outBuf, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) return res.status(500).json({ error: upErr.message });

  await redirectToSignedUrl(res, generatedPath);
});

// Serves this patient's gear file with their saved replacements baked
// directly into the .docx — the shared template in storage (served above by
// /api/diet-file/:id) is never modified; this generates a one-off copy on
// each request. Falls back to the unmodified file when there's nothing
// saved for this patient+gear (or it was saved against a different file),
// so the download link always works even before any replacement is made.
app.get('/api/diet-file/:id/for/:personKey/gear/:gear', async (req, res) => {
  const { id, personKey, gear } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(gear)) return res.status(400).json({ error: 'Invalid gear' });

  const entry = manifestFiles.find((f) => f.id === id);
  if (!entry) return res.status(404).json({ error: 'File not found' });

  const overrides = await readOverrides(personKey);
  const gearData = overrides.gears[gear];
  const replacements = gearData && gearData.manifestId === id ? gearData.replacements || [] : [];
  const downloadName = `${personKey}_gear${gear}_${entry.fileName}`;

  if (!replacements.length) {
    return redirectToSignedUrl(res, entry.relPath, downloadName);
  }

  let originalBuf;
  try {
    originalBuf = await downloadTemplate(entry.relPath);
  } catch (err) {
    return res.status(404).json({ error: 'File not found in storage' });
  }

  let outBuf = originalBuf;
  try {
    outBuf = await applyReplacementsToDocx(originalBuf, replacements);
  } catch (err) {
    console.error(`Failed to apply replacements for ${personKey} gear ${gear}, serving unmodified file:`, err);
  }

  // Personalized copies are cheap to regenerate and don't need to stick
  // around long — this just gives the browser a signed URL to download
  // from directly instead of streaming the (sometimes 15-20MB) result
  // through this function's response.
  const generatedPath = `_generated/${personKey}_gear${gear}_${id}.docx`;
  const { error: upErr } = await supabaseAdmin.storage.from(CONTENT_BUCKET).upload(generatedPath, outBuf, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) return res.status(500).json({ error: upErr.message });

  await redirectToSignedUrl(res, generatedPath, downloadName);
});

app.get('/api/food-rules', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ rules: foodRules });
});

const VALID_DIET_TYPES = new Set(['VEG', 'NONVEG', 'EGG']);
const VALID_LANGUAGES = new Set(['TAM', 'ENG']);
const FALLBACK_TEXT = {
  ENG: 'Ask dietitian for a suitable alternative',
  TAM: 'உகந்த மாற்று உணவுக்கு டயட்டீஷியனிடம் கேளுங்கள்',
};

// Curated-list fallback for when the AI call fails (missing/invalid key,
// Gemini outage, malformed response, timeout) — reuses the same category
// data /api/food-rules exposes, so a coach always gets *something* usable
// even if Gemini is unavailable, rather than the "Auto" button just breaking.
function curatedFallback(term, dietType, language) {
  const rule = findRuleForTerm(term);
  if (!rule) return [FALLBACK_TEXT[language] || FALLBACK_TEXT.ENG];
  const table = (language === 'TAM' && rule.substitutesTamil) || rule.substitutes;
  const list = (dietType && table[dietType]) || table.VEG || Object.values(table)[0];
  return list && list.length ? list : [FALLBACK_TEXT[language] || FALLBACK_TEXT.ENG];
}

app.post('/api/suggest-alternative', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { term, dietType, language } = req.body || {};
  if (typeof term !== 'string' || !term.trim()) return res.status(400).json({ error: 'term is required' });
  const safeDietType = VALID_DIET_TYPES.has(dietType) ? dietType : null;
  const safeLanguage = VALID_LANGUAGES.has(language) ? language : 'ENG';

  try {
    const items = await suggestAlternativesViaAI({ term, dietType: safeDietType, language: safeLanguage });
    return res.json({ items, source: 'ai' });
  } catch (err) {
    console.error(`Gemini suggestion failed for "${term}", falling back to curated list:`, err.message);
    return res.json({ items: curatedFallback(term, safeDietType, safeLanguage), source: 'fallback' });
  }
});

app.get('/api/patient-data/:personKey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  try {
    // All three replacement systems' saved state in one response — the
    // client already fetches "everything saved for this patient" in a single
    // call (DietViewerPanel's/GearViewer's mount effect), so the newer
    // recipe- and schedule-override systems ride along in the same shape
    // rather than each needing their own round trip.
    const [textOverrides, recipeOverrides, scheduleOverrides] = await Promise.all([
      readOverrides(personKey),
      readRecipeOverrides(personKey),
      readScheduleOverrides(personKey),
    ]);
    res.json({ ...textOverrides, recipeOverrideGears: recipeOverrides.gears, scheduleOverrideGears: scheduleOverrides.gears });
  } catch (err) {
    console.error(`Failed to read overrides for ${personKey}:`, err);
    res.status(500).json({ error: 'Could not load saved patient data' });
  }
});

// A malformed or huge replacements array can't corrupt anything (docxReplace
// silently skips entries missing originalText/replacementText), but this is
// a shared Postgres table now rather than a per-patient local file, so it's
// worth bounding what an authenticated caller can wedge into one row.
const MAX_REPLACEMENTS = 200;
function isValidReplacements(replacements) {
  return (
    Array.isArray(replacements) &&
    replacements.length <= MAX_REPLACEMENTS &&
    replacements.every(
      (r) => r && typeof r === 'object' && typeof r.originalText === 'string' && typeof r.replacementText === 'string'
    )
  );
}

app.put('/api/patient-data/:personKey/gear/:gear', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey, gear } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(gear)) return res.status(400).json({ error: 'Invalid gear' });
  const { manifestId, replacements } = req.body || {};
  if (!isValidReplacements(replacements)) {
    return res.status(400).json({ error: `replacements must be an array of at most ${MAX_REPLACEMENTS} { originalText, replacementText } items` });
  }
  try {
    const saved = await writeGearOverride(personKey, gear, { manifestId, replacements });
    res.json(saved);
  } catch (err) {
    console.error(`Failed to save override for ${personKey} gear ${gear}:`, err);
    res.status(500).json({ error: 'Could not save patient data' });
  }
});

// A recipe_id is a 16-hex-char sha1 prefix (see build-recipe-library.js) —
// bounding the shape here the same way isValidReplacements bounds the old
// text-splice shape above, since this is a shared table any authenticated
// caller can write a row into.
const MAX_RECIPE_OVERRIDES = 100;
const RECIPE_ID_RE = /^[0-9a-f]{16}$/;
const DIET_IMAGE_PATH_RE = /^\/api\/diet-image\/[0-9a-f]{16}\.(jpg|png|gif)$/;

// Every override carries its FULL replacement content inline
// ({originalRecipeId, recipe: {...}}), not just a pointer into the shared
// library — deliberately, even for a plain "picked from the library"
// replacement: a library recipe_id is a content hash of the SOURCE
// document's text (build-recipe-library.js), which could in principle shift
// if that source document is ever re-migrated, silently breaking a
// previously-saved reference. Storing the content once, at selection time,
// means a saved replacement stays exactly what the dietitian picked
// regardless of what happens to the library afterward — and manual entries
// and AI suggestions (never in the library at all) need this shape anyway,
// so one shape for all three keeps GearViewer's resolution logic uniform.
function isValidOverrideRecipe(r) {
  return (
    r && typeof r === 'object' &&
    typeof r.name === 'string' && r.name.length > 0 && r.name.length <= 200 &&
    Array.isArray(r.ingredients) && r.ingredients.length <= 60 && r.ingredients.every((s) => typeof s === 'string' && s.length <= 300) &&
    Array.isArray(r.steps) && r.steps.length <= 60 && r.steps.every((s) => typeof s === 'string' && s.length <= 1000) &&
    (r.image === undefined || r.image === null || (typeof r.image === 'string' && DIET_IMAGE_PATH_RE.test(r.image)))
  );
}
// Three override shapes share this one array (see client/src/lib/
// applyRecipeOverrides.js):
//   - REPLACEMENT: { originalRecipeId, recipe } — originalRecipeId names the
//     slot being swapped out.
//   - ADDITION: { recipe, groupHeading? } (no originalRecipeId) — a wholly
//     new recipe appended to the named category tab (Recipes, Herbal Tea,
//     Kashayas...) the coach had open when they added it; falls back to a
//     generic "Added Recipes" bucket client-side if groupHeading is absent.
//   - REMOVAL: { originalRecipeId, removed: true } (no recipe) — that slot
//     is dropped from the plan entirely, via [Remove] on any card.
const MAX_GROUP_HEADING = 100;
function isValidRecipeOverrides(overrides) {
  return (
    Array.isArray(overrides) &&
    overrides.length <= MAX_RECIPE_OVERRIDES &&
    overrides.every((o) => {
      if (!o || typeof o !== 'object') return false;
      if (o.removed === true) return typeof o.originalRecipeId === 'string' && RECIPE_ID_RE.test(o.originalRecipeId);
      if (o.groupHeading !== undefined && o.groupHeading !== null && (typeof o.groupHeading !== 'string' || o.groupHeading.length > MAX_GROUP_HEADING)) return false;
      return (o.originalRecipeId === undefined || o.originalRecipeId === null || RECIPE_ID_RE.test(o.originalRecipeId))
        && isValidOverrideRecipe(o.recipe);
    })
  );
}

app.put('/api/patient-data/:personKey/gear/:gear/recipe-overrides', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey, gear } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(gear)) return res.status(400).json({ error: 'Invalid gear' });
  const { overrides } = req.body || {};
  if (!isValidRecipeOverrides(overrides)) {
    return res.status(400).json({ error: `overrides must be an array of at most ${MAX_RECIPE_OVERRIDES} { originalRecipeId, recipe: { name, ingredients, steps, image? } } items` });
  }
  try {
    const saved = await writeRecipeOverride(personKey, gear, overrides);
    res.json(saved);
  } catch (err) {
    console.error(`Failed to save recipe override for ${personKey} gear ${gear}:`, err);
    res.status(500).json({ error: 'Could not save recipe override' });
  }
});

// A Diet Schedule cell edit is keyed positionally, not by recipe_id — see
// scheduleOverrideStore.js's own comment for why this is a separate table
// from diet_recipe_overrides. tableKey mirrors client/src/lib/
// applyScheduleOverrides.js's own key builders exactly ("mealplan:<title>"/
// "infotable:<title>"); rowIndex/colIndex are that table's own row/column
// position at the time of editing (0-based) — a template re-migration that
// reorders rows would silently misapply an old edit, same accepted
// trade-off as the "position, not identity" schedule remarkKeys already
// make (see DietTemplateView.jsx's scheduleRowRemarkKey comment).
const MAX_SCHEDULE_OVERRIDES = 300;
const MAX_TABLE_KEY = 200;
const MAX_CELL_VALUE = 2000;
function isValidScheduleOverrides(overrides) {
  return (
    Array.isArray(overrides) &&
    overrides.length <= MAX_SCHEDULE_OVERRIDES &&
    overrides.every((o) => (
      o && typeof o === 'object'
      && typeof o.tableKey === 'string' && o.tableKey.length > 0 && o.tableKey.length <= MAX_TABLE_KEY
      && Number.isInteger(o.rowIndex) && o.rowIndex >= 0
      && Number.isInteger(o.colIndex) && o.colIndex >= 0
      && typeof o.value === 'string' && o.value.length <= MAX_CELL_VALUE
    ))
  );
}

app.put('/api/patient-data/:personKey/gear/:gear/schedule-overrides', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey, gear } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(gear)) return res.status(400).json({ error: 'Invalid gear' });
  const { overrides } = req.body || {};
  if (!isValidScheduleOverrides(overrides)) {
    return res.status(400).json({ error: `overrides must be an array of at most ${MAX_SCHEDULE_OVERRIDES} { tableKey, rowIndex, colIndex, value } items` });
  }
  try {
    const saved = await writeScheduleOverride(personKey, gear, overrides);
    res.json(saved);
  } catch (err) {
    console.error(`Failed to save schedule override for ${personKey} gear ${gear}:`, err);
    res.status(500).json({ error: 'Could not save schedule edit' });
  }
});

app.get('/api/patient-status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ statuses: await listAllStatuses() });
  } catch (err) {
    console.error('Failed to list patient statuses:', err);
    res.status(500).json({ error: 'Could not load patient statuses' });
  }
});

app.get('/api/patient-status/:personKey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  try {
    res.json({ statuses: await getStatusesForPerson(personKey) });
  } catch (err) {
    console.error(`Failed to load statuses for ${personKey}:`, err);
    res.status(500).json({ error: 'Could not load patient statuses' });
  }
});

// Open to any signed-in staff member (not requireDeveloper) — marking a
// call done or a gear completed is routine day-to-day tracking, unlike the
// dev-only issue/requirement triage below.
app.put('/api/patient-status/:personKey/gear/:gear', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey, gear } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(gear)) return res.status(400).json({ error: 'Invalid gear' });
  const { status } = req.body || {};
  if (status !== null && !PATIENT_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be null or one of: ${[...PATIENT_STATUSES].join(', ')}` });
  }
  try {
    if (status === null) {
      await clearStatus(personKey, gear);
      return res.json({ personKey, gear: Number(gear), status: null });
    }
    const updatedByName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone';
    res.json(await setStatus(personKey, gear, status, updatedByName));
  } catch (err) {
    console.error(`Failed to set status for ${personKey} gear ${gear}:`, err);
    res.status(500).json({ error: 'Could not save status' });
  }
});

// Only gears 2/3/4 carry a TL-verification lifecycle at all (see
// gearStatus.js's GATED_GEARS / gearTLVerified) — same scope every other
// TL-verification read in this app already uses.
const TL_VERIFY_GEARS = new Set([2, 3, 4]);

// Gated to requireTL (see server/lib/roles.js): only a 'tl' or 'developer'
// account can write these fields. Writes straight into the live spreadsheet
// cells (see server/lib/tlVerificationWriter.js) rather than a Supabase
// table, since the sheet already has dedicated columns for all of this and
// coaches need to see it there too, not just inside this app.
app.put('/api/tl-verification/:sheetName/:studentId/gear/:gear', requireTL, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { sheetName, studentId, gear } = req.params;
  const gearNum = Number(gear);
  if (!TL_VERIFY_GEARS.has(gearNum)) return res.status(400).json({ error: 'gear must be 2, 3, or 4' });

  // Same override pattern as GET /api/sheets/:name: a custom spreadsheetId
  // (from "Switch sheet") writes into that spreadsheet's own row instead of
  // the default tracker's — unlike Mark Call Done/weight history, this never
  // touches the shared Supabase tables keyed by Student ID, it only ever
  // writes into whichever spreadsheet's own data it just read, so a custom
  // sheet reusing an ID that belongs to a real patient elsewhere can't
  // corrupt anything.
  const rawSpreadsheetId = req.query.spreadsheetId;
  let spreadsheetId = sheetsConfig.spreadsheetId;
  if (rawSpreadsheetId) {
    if (!SPREADSHEET_ID_PATTERN.test(rawSpreadsheetId)) return res.status(400).json({ error: 'Invalid spreadsheet id' });
    spreadsheetId = rawSpreadsheetId;
  } else {
    const configured = sheetsConfig.sheets.find((s) => s.name === sheetName);
    if (!configured) return res.status(404).json({ error: `Unknown sheet "${sheetName}"` });
  }

  const { verified, dietAccuracy, dietQuality, remarks } = req.body || {};
  if (verified !== undefined && typeof verified !== 'boolean') {
    return res.status(400).json({ error: 'verified must be a boolean' });
  }
  if (dietAccuracy !== undefined && dietAccuracy !== '' && !DIET_ACCURACY_VALUES.has(dietAccuracy)) {
    return res.status(400).json({ error: `dietAccuracy must be one of: ${[...DIET_ACCURACY_VALUES].join(', ')}` });
  }
  if (dietQuality !== undefined && dietQuality !== '' && !DIET_QUALITY_VALUES.has(dietQuality)) {
    return res.status(400).json({ error: `dietQuality must be one of: ${[...DIET_QUALITY_VALUES].join(', ')}` });
  }
  if (remarks !== undefined && (typeof remarks !== 'string' || remarks.length > 2000)) {
    return res.status(400).json({ error: 'remarks must be a string up to 2000 characters' });
  }

  try {
    // writeTLVerification locates the row itself, through the same
    // authenticated grid it writes to (see sheetGrid.js) — it needs no
    // pre-fetched read here.
    const result = await writeTLVerification({
      spreadsheetId,
      sheetName,
      studentId,
      gear: gearNum,
      verified,
      dietAccuracy,
      dietQuality,
      remarks,
    });
    cache.delete(`${rawSpreadsheetId ? spreadsheetId : 'default'}:${sheetName}`);
    res.json({ ok: true, ...result });

    // Best-effort, after the response is sent — an Effort Goal logging
    // hiccup should never fail the actual verification. Only actually
    // *marking* Verified counts as today's effort, not editing remarks on an
    // already-verified gear or un-verifying one.
    if (verified === true) {
      logEffort({
        personKey: patientKey(sheetName, { studentId }),
        gear: gearNum,
        action: 'verified',
        performedById: req.user.id,
        performedByName: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
      }).catch((err) => console.error(`Failed to log verification effort for ${studentId} gear ${gear}:`, err));
    }
  } catch (err) {
    console.error(`Failed to write TL verification for ${studentId} gear ${gear}:`, err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Any signed-in staff member can mark a gear prepared (not requireTL — this
// is the Team Member side, same "routine day-to-day tracking" reasoning as
// Mark Call Done above). Writes "Done" straight into the sheet's own "Gear N
// Preparation status" cell instead of a coach editing it by hand, and logs
// who/when for the Effort Goal dashboard.
app.put('/api/mark-prepared/:sheetName/:studentId/gear/:gear', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { sheetName, studentId, gear } = req.params;
  const gearNum = Number(gear);
  if (!TL_VERIFY_GEARS.has(gearNum)) return res.status(400).json({ error: 'gear must be 2, 3, or 4' });

  // Same override pattern as /api/tl-verification above.
  const rawSpreadsheetId = req.query.spreadsheetId;
  let spreadsheetId = sheetsConfig.spreadsheetId;
  if (rawSpreadsheetId) {
    if (!SPREADSHEET_ID_PATTERN.test(rawSpreadsheetId)) return res.status(400).json({ error: 'Invalid spreadsheet id' });
    spreadsheetId = rawSpreadsheetId;
  } else {
    const configured = sheetsConfig.sheets.find((s) => s.name === sheetName);
    if (!configured) return res.status(404).json({ error: `Unknown sheet "${sheetName}"` });
  }

  try {
    const result = await writePrepStatus({ spreadsheetId, sheetName, studentId, gear: gearNum });
    cache.delete(`${rawSpreadsheetId ? spreadsheetId : 'default'}:${sheetName}`);
    res.json({ ok: true, ...result });

    logEffort({
      personKey: patientKey(sheetName, { studentId }),
      gear: gearNum,
      action: 'prepared',
      performedById: req.user.id,
      performedByName: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
    }).catch((err) => console.error(`Failed to log prep effort for ${studentId} gear ${gear}:`, err));
  } catch (err) {
    console.error(`Failed to mark prepared for ${studentId} gear ${gear}:`, err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Today's per-person prepared/verified counts vs. the program's daily
// targets — feeds the Dashboard's "Effort Goal" section. Targets are fixed
// program constants (see the tracker's own "EFFORT GOAL" reference), not
// per-sheet configuration.
const EFFORT_TARGETS = { prepared: 30, verified: 45 };
app.get('/api/effort-summary', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const counts = await todaysCountsByPerson();
    res.json({ targets: EFFORT_TARGETS, counts });
  } catch (err) {
    console.error('Failed to load effort summary:', err);
    res.status(500).json({ error: 'Could not load effort summary' });
  }
});

// personKey:gear -> when it was marked prepared via "Mark Prepared" — the
// Prep %/Verification % report's client-side calculation (lib/teamPerformance.js)
// combines this with the already-fetched sheet data (Due Date, blood status,
// TL verification) to work out which diets were prepared "on time".
app.get('/api/effort-log/prepared-times', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const map = await latestPreparedAt();
    res.json({ preparedAt: Object.fromEntries(map) });
  } catch (err) {
    console.error('Failed to load prepared-times:', err);
    res.status(500).json({ error: 'Could not load prepared times' });
  }
});

app.get('/api/patient-weight/:personKey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  try {
    res.json({ history: await listWeightHistory(personKey) });
  } catch (err) {
    console.error(`Failed to load weight history for ${personKey}:`, err);
    res.status(500).json({ error: 'Could not load weight history' });
  }
});

// Combined "what happened, when, by whom" feed for the profile page's
// Activity Timeline — see server/lib/patientActivityStore.js for what feeds
// into it. Same personKey scoping/safety as the routes above.
app.get('/api/patient-activity/:personKey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  try {
    res.json({ events: await listPatientActivity(personKey) });
  } catch (err) {
    console.error(`Failed to load activity for ${personKey}:`, err);
    res.status(500).json({ error: 'Could not load activity' });
  }
});

app.get('/api/profile', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const role = await getUserRole(req.user.id);
    res.json({ email: req.user.email, role: role || 'employee' });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile' });
  }
});

// Developer-only: lists every signed-up account and its role, and lets a
// developer promote/demote someone (e.g. grant 'tl'). This is the only way
// a 'tl' account gets created — signup always defaults to 'employee'.
app.get('/api/team', requireDeveloper, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ team: await listTeam() });
  } catch (err) {
    console.error('Failed to list team:', err);
    res.status(500).json({ error: 'Could not load team' });
  }
});

const VALID_ROLES = new Set(['employee', 'tl', 'developer']);
app.patch('/api/team/:id/role', requireDeveloper, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { role } = req.body || {};
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  try {
    res.json(await setRole(req.params.id, role));
  } catch (err) {
    console.error(`Failed to update role for ${req.params.id}:`, err);
    res.status(500).json({ error: 'Could not update role' });
  }
});

app.get('/api/issues', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ issues: await listIssues() });
  } catch (err) {
    console.error('Failed to list issues:', err);
    res.status(500).json({ error: 'Could not load issues' });
  }
});

app.post('/api/issues', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { kind, urgency, title, screen, whatHappened, reproSteps } = req.body || {};
  if (!ISSUE_KINDS.has(kind)) return res.status(400).json({ error: 'kind must be "bug" or "enhancement"' });
  if (urgency && !ISSUE_URGENCIES.has(urgency)) return res.status(400).json({ error: 'Invalid urgency' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const raisedBy = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
    };
    const issue = await createIssue({
      kind,
      urgency,
      title: title.trim(),
      screen: typeof screen === 'string' ? screen.trim() : '',
      whatHappened: typeof whatHappened === 'string' ? whatHappened.trim() : '',
      reproSteps: typeof reproSteps === 'string' ? reproSteps.trim() : '',
      raisedBy,
    });
    res.status(201).json(issue);
  } catch (err) {
    console.error('Failed to create issue:', err);
    res.status(500).json({ error: 'Could not raise the issue' });
  }
});

app.patch('/api/issues/:id/status', requireDeveloper, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await updateIssueStatus(req.params.id, req.body?.status));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get('/api/requirements', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ requirements: await listRequirements() });
  } catch (err) {
    console.error('Failed to list requirements:', err);
    res.status(500).json({ error: 'Could not load requirements' });
  }
});

app.post('/api/requirements', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { priority, title, area, description } = req.body || {};
  if (priority && !REQUIREMENT_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const requestedBy = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
    };
    const requirement = await createRequirement({
      priority,
      title: title.trim(),
      area: typeof area === 'string' ? area.trim() : '',
      description: typeof description === 'string' ? description.trim() : '',
      requestedBy,
    });
    res.status(201).json(requirement);
  } catch (err) {
    console.error('Failed to create requirement:', err);
    res.status(500).json({ error: 'Could not add the requirement' });
  }
});

app.patch('/api/requirements/:id/status', requireDeveloper, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await updateRequirementStatus(req.params.id, req.body?.status));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// The "Diet Remarks" sidebar panel — every TL-raised highlight across every
// patient, newest first. Open to any signed-in staff member: an employee
// needs to see what's pending against their own patients same as a TL needs
// to track what they've raised.
app.get('/api/diet-remarks', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ remarks: await listAllRemarks() });
  } catch (err) {
    console.error('Failed to list diet remarks:', err);
    res.status(500).json({ error: 'Could not load diet remarks' });
  }
});

// Every remark across every gear for one patient — what GearViewer fetches
// to know which blocks of the plan on screen need a highlight.
app.get('/api/diet-remarks/patient/:personKey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey } = req.params;
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  try {
    res.json({ remarks: await listRemarksForPatient(personKey) });
  } catch (err) {
    console.error(`Failed to list diet remarks for ${personKey}:`, err);
    res.status(500).json({ error: 'Could not load diet remarks' });
  }
});

const MAX_REMARK_TEXT = 500;
const MAX_REMARK_COMMENT = 2000;

// TL-only: highlight one block of a patient's diet plan and explain why.
// personKey/gear/remarkKey identify WHICH block (see client/src/lib/
// dietRemarkKey.js); patientName/healthCoachName/batch/conditionLabel are a
// point-in-time snapshot for the cross-patient panel (see
// dietRemarksStore.js's own comment for why that isn't a live join).
app.post('/api/diet-remarks', requireTL, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { personKey, gear, remarkKey, highlightedText, comment, patientName, healthCoachName, batch, conditionLabel } = req.body || {};
  if (!isSafeKey(personKey)) return res.status(400).json({ error: 'Invalid patient key' });
  if (!/^\d+$/.test(String(gear))) return res.status(400).json({ error: 'Invalid gear' });
  if (typeof remarkKey !== 'string' || !remarkKey.trim() || remarkKey.length > 200) {
    return res.status(400).json({ error: 'remarkKey is required' });
  }
  if (typeof highlightedText !== 'string' || !highlightedText.trim() || highlightedText.length > MAX_REMARK_TEXT) {
    return res.status(400).json({ error: `highlightedText is required (max ${MAX_REMARK_TEXT} chars)` });
  }
  if (typeof comment !== 'string' || !comment.trim() || comment.length > MAX_REMARK_COMMENT) {
    return res.status(400).json({ error: `comment is required (max ${MAX_REMARK_COMMENT} chars)` });
  }
  try {
    const raisedBy = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
    };
    const remark = await createRemark({
      personKey,
      gear: Number(gear),
      remarkKey: remarkKey.trim(),
      highlightedText: highlightedText.trim(),
      comment: comment.trim(),
      patientName: typeof patientName === 'string' ? patientName.trim() : '',
      healthCoachName: typeof healthCoachName === 'string' ? healthCoachName.trim() : '',
      batch: typeof batch === 'string' ? batch.trim() : '',
      conditionLabel: typeof conditionLabel === 'string' ? conditionLabel.trim() : '',
      raisedBy,
    });
    res.status(201).json(remark);
  } catch (err) {
    console.error('Failed to create diet remark:', err);
    res.status(500).json({ error: 'Could not save the highlight' });
  }
});

// Open to any signed-in staff member — the coach who fixed the flagged
// content is the one clicking this, not the TL who raised it.
app.put('/api/diet-remarks/:id/resolve', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const resolvedByName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone';
    res.json(await resolveRemark(req.params.id, resolvedByName));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Open to any signed-in staff member, same as resolve above — fired
// automatically (not a button the coach clicks) whenever an edit or replace
// lands on a slot that currently carries a pending remark, so the flag
// follows the slot onto its new content instead of silently going stale
// (see client/src/components/GearViewer.jsx's maybeRekeyRemark). Only ever
// moves a PENDING remark (rekeyRemark itself guards on status='pending') —
// an already-resolved one is left alone.
app.put('/api/diet-remarks/:id/rekey', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { newRemarkKey } = req.body || {};
  if (typeof newRemarkKey !== 'string' || !newRemarkKey.trim() || newRemarkKey.length > 200) {
    return res.status(400).json({ error: 'newRemarkKey is required' });
  }
  try {
    res.json(await rekeyRemark(req.params.id, newRemarkKey.trim()));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// TL-only, and only the TL who raised it — retracts a mis-flagged highlight
// without it ever counting as the coach's own resolve.
app.delete('/api/diet-remarks/:id', requireTL, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await deleteRemark(req.params.id, req.user.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// "Patient Details Edit" sidebar page (TL/developer only, see Sidebar.jsx) —
// which of the fixed field catalog (ALL_PATIENT_DETAIL_FIELD_KEYS) shows on
// EVERY diet plan's cover page. Read is open to any signed-in staff (every
// GearViewer load needs it); writing it is TL-gated (same tier as raising a
// Diet Remark / TL-verifying a plan — not Team management's developer-only
// tier), since it changes what every coach sees globally and a TL is
// already trusted with plan-wide review actions in this app.
app.get('/api/patient-detail-fields', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ fields: await getPatientDetailFields(), allFieldKeys: ALL_PATIENT_DETAIL_FIELD_KEYS });
  } catch (err) {
    console.error('Failed to load patient detail fields config:', err);
    res.status(500).json({ error: 'Could not load field configuration' });
  }
});

app.put('/api/patient-detail-fields', requireTL, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { fields } = req.body || {};
  const valid = fields && typeof fields === 'object'
    && PATIENT_DETAIL_FIELD_CATEGORIES.every((category) => {
      const keys = fields[category];
      const allKeys = ALL_PATIENT_DETAIL_FIELD_KEYS[category];
      return Array.isArray(keys) && keys.length > 0 && keys.length <= allKeys.length
        && keys.every((k) => allKeys.includes(k))
        && new Set(keys).size === keys.length;
    });
  if (!valid) {
    return res.status(400).json({
      error: 'fields must include a non-empty, unique array per category (' + PATIENT_DETAIL_FIELD_CATEGORIES.join(', ') + '), each drawn from its own catalog',
    });
  }
  try {
    const updatedByName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone';
    res.json({ fields: await savePatientDetailFields(fields, updatedByName) });
  } catch (err) {
    console.error('Failed to save patient detail fields config:', err);
    res.status(500).json({ error: 'Could not save field configuration' });
  }
});

// ---- Register Student module: the app's own native student registry,
// replacing the need for an external sheet for new data entry (see
// server/lib/studentsStore.js / supabase/schema.sql's diet_students table).
// Open to any signed-in staff member for read/create/update — this is meant
// to be filled in by an employee/health coach during intake, same trust
// level as raising an issue or a requirement. Delete is TL-or-developer only,
// same tier as the other destructive actions in this file.
function actorFromReq(req) {
  return {
    id: req.user.id,
    name: req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Someone',
  };
}

app.get('/api/students', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ students: await listStudents() });
  } catch (err) {
    console.error('Failed to list students:', err);
    res.status(500).json({ error: 'Could not load students' });
  }
});

// A specific literal path registered before '/api/students/:id' below, so
// Express can never let ':id' swallow "export.csv" as an id param.
app.get('/api/students/export.csv', async (req, res) => {
  try {
    const students = await listStudents();
    const csv = toCSV(exportHeaders(), exportRows(students));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Failed to export students:', err);
    res.status(500).json({ error: 'Could not export students' });
  }
});

app.post('/api/students', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const student = await createStudent(req.body || {}, actorFromReq(req));
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.put('/api/students/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await updateStudent(req.params.id, req.body || {}, actorFromReq(req)));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete('/api/students/:id', requireTL, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await deleteStudent(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Bulk "Upload Sheet": body is the raw CSV text (read client-side via
// FileReader, same pattern as this app's existing base64 image uploads) —
// never deletes anything, a row naming an existing Student ID updates it,
// everything else inserts fresh. See bulkImportStudents for the full
// column-matching/upsert behavior.
app.post('/api/students/import', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { csvText } = req.body || {};
  if (typeof csvText !== 'string' || !csvText.trim()) return res.status(400).json({ error: 'csvText is required' });
  try {
    res.json(await bulkImportStudents(csvText, actorFromReq(req)));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ---- serve built frontend in production ----
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// On Vercel this module is required by api/index.js as a serverless
// function handler (Vercel invokes the exported app directly per-request);
// only bind a real port when run standalone, e.g. `node index.js` locally.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Diet tracker server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
