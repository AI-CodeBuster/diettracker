// Converts any diet-plan .docx (any gear, either language) into the diet-data
// JSON shape. Supersedes the Gear 2-only converter.
//
// The two halves of this have very different reliability, and the split is
// deliberate — see scripts/validate-conversion.js for the measured scores:
//
//   TABLES are reliable. A day-table is recognised by its first header cell
//   ("Day"/"Days"/"நாள்"/"நாட்களில்"), captioned from the short label directly
//   above it (or the gear's meal name where the source has none), and its rows
//   come across verbatim. Scored 100% against both hand-verified files —
//   titles, columns and every row. Non-day tables are kept as infoTables
//   rather than dropped, since Gear 4 carries real guidance in them.
//
//   RECIPES are a draft — 13/15 and 10/14 against the two hand-verified
//   files. What the remaining gap is made of: a few recipes carry no
//   "Ingredients:"/"Preparation:" marker at all ("Nuts:", "Making the
//   Vegetable Bowl"), and loosening the rule far enough to catch them
//   re-admits ordinary sentences as recipes; and the hand files renamed
//   sections editorially (the source's "Salad dressings:" became "Mint
//   Chutney for Salad Dressing"), which no rule recovers. Output therefore
//   carries meta.recipesReviewed = false until a human has checked it against
//   the source, and the viewer shows a banner while that flag is false.
//
// Section grouping follows the user's layout, not the source document's: every
// recipe lands in one "Recipes" group, fruit and nuts share "Fruits & Nuts",
// herbal tea and any preparation method stay separate (server/diet-data/schema.md).

// Matched as a PREFIX, not for equality: Tamil inflects the word for its
// grammatical case, so the same column is headed "நாள்" in Gear 2 and
// "நாட்களில்" in Gear 4, and English varies between "Day" and "Days". The
// prefixes stop before the inflecting suffix — "நாட்கள்" and "நாட்களில்"
// diverge at the vowel sign after ள, so the shared part ends at "நாட்க".
const DAY_WORDS = ['day', 'நாள', 'நாட்க'];

// Bold section markers, both languages. Tamil equivalents were read off the
// documents themselves: தேவையான பொருட்கள் = required ingredients,
// தயாரிப்பு முறைகள் / வழிமுறைகள் = preparation methods / instructions.
//
// No \b anywhere near the Tamil alternatives: JavaScript's word boundary is
// defined against ASCII \w, so a \b after a Tamil letter never matches and
// silently kills the whole alternative. That bug cost every Tamil recipe in
// the first migration run — 57 documents reported "no recipes extracted".
const ING_MARKER = /^(ingredients?\b|தேவையான\s*பொருட்கள்)/i;
const STEP_MARKER = /^(preparation\b|procedure\b|instructions?\b|method\b|how to make\b|recipe\b|recipes\b|தயாரிப்பு\s*முறைகள்|வழிமுறைகள்|செய்முறை)/i;
const NOISE = /^(important\s*note|note\b|முக்கிய\s*குறிப்பு|முக்கியமான\s*குறிப்பு)[:\s]/i;
const TEA_HEADING = /^(herbal tea\b|மூலிகை\s*தேநீர்)/i;
const NUTS_NAME = /^(nuts?\b|பருப்பு\s*வகைகள்|கொட்டைகள்|நட்ஸ்)/i;
const LEACH_NAME = /leach|ஊறவைத்தல்/i;
const FRUIT_HEADING = /^(fruits?\s*suggestions?\b|fruits?\s*law\b|fruits?\b|பழ\s*பரிந்துரைகள்|பழங்கள்\s*சட்டம்|பழங்கள்)/i;
// "Option N: <name>" sub-headings are reused everywhere in this corpus
// (salads, kashayams, thuvaiyal, soups...) and are inconsistently bold from
// document to document — some bold only the first option and leave "Option
// 2"/"Option 3" as plain text. Recognising the text pattern itself, not just
// boldness, is what tells a genuine new recipe heading like "Option 2: Tulsi
// Leaf Kashayam" apart from an ordinary ingredient/step sentence.
const OPTION_HEADING = /^option\s*-?\s*\d+\s*[:.]|^விருப்பம்\s*\d+\s*[:.]/i;
// Gear 2/3's "Fruits Suggestions" is a short slash-separated list of fruit
// names ("Apple / Guava / Papaya") — parsed below into a fake recipe-shaped
// card so it renders like the other cards. Gear 4's own fruit heading is
// "Fruits Law" and holds full guideline SENTENCES ("Do not mix fruits..."),
// not a variety list at all — forcing that through the same variety-parser
// would treat each sentence as one "ingredient". Distinguished by the
// heading text itself (does it say "law"?) rather than by guessing from the
// shape of the lines underneath it.
const FRUIT_LAW_HEADING = /\blaw\b|சட்டம்/i;

// Gear 4's own named sub-sections — Kashayas, Snacks, and within its "Dinner
// Recipes": Kanji, Thuvaiyal Recipes (for the kanji), Dinner Millet Recipes,
// Dinner Soups Recipe. Wording varies across the 92 Gear 4 documents
// ("Kashayam" vs "Kashayas", "Thuvaiyal Recipe" vs "Recipes", a hyphen in
// "Dinner - Soups Recipe" in some, absent in others) and NOT every document
// has all of them (Kidney's has no separate Millet section at all) — so
// these are prefix patterns tolerant of that variation, matched as zone
// boundaries in groupRecipes() below rather than assumed to all be present
// or in a fixed order (English and Tamil documents don't even agree on
// which of Kashayas/Snacks/Herbal Tea comes first).
const KASHAYA_HEADING = /^kashayam?s?\b|கஷாயங்கள்/i;
const SNACKS_HEADING = /^snacks?\b|சிற்றுண்டி/i;
const KANJI_HEADING = /^kanji\b|கஞ்சி/i;
const THUVAIYAL_HEADING = /^thuvaiyal recipes?\b|துவையல்\s*வகைகள்/i;
const MILLET_HEADING = /^dinner\s*millet\s*recipes?\b|இரவு\s*சிறுதானிய\s*சமையல்\s*வகைகள்/i;
const SOUPS_HEADING = /^dinner\s*-?\s*soups?\s*recipe\b|இரவு\s*உணவு\s*-?\s*சூப்கள்\s*செய்முறை/i;

// Gear 3's own named sub-sections. Every English Gear 3 document (22/22
// checked) carries all of Category 1/2/3, Cutting Types, Salad Law(s), Water
// Law, and the product-shopping form heading, in that order; the Tamil
// siblings carry exactly the same content under Tamil headings (வகை 1/2/3
// etc — confirmed by direct inspection, not assumed from the English count).
// "Salad recipes" is a SECOND trigger for the Category 1 zone: the source
// states the category's own descriptive heading early (with just a short
// preview list under it), then the real "Salad recipes" Option 1..N cards
// much later in the document, after Category 2 and 3 have already come and
// gone — without this second trigger those real recipes would zone-match
// to Category 3 by simple position (the nearest PRECEDING zone heading),
// since nothing else resets the zone back to Category 1 in between. A
// handful of Gear 2 documents (Diabetes/Thyroid VEG) also carry a bare
// "Salad Laws" section of their own, unrelated to Gear 3's Category
// structure — matched here too since the pattern is gear-agnostic by
// design, same as every other zone above.
const CATEGORY1_HEADING = /^category\s*1\b|^வகை\s*1\b/i;
const CATEGORY2_HEADING = /^category\s*2\b|^வகை\s*2\b/i;
const CATEGORY3_HEADING = /^category\s*3\b|^வகை\s*3\b/i;
const SALAD_RECIPES_HEADING = /^salad\s*recipes?\b|சாலட்\s*சமையல்\s*வகைகள்/i;
const CUTTING_TYPES_HEADING = /^(salad\s*)?cutting\s*types?\b|வெட்டும்\s*வகைகள்/i;
const SALAD_LAW_HEADING = /^salad\s*laws?\b|சாலட்\s*சட்டங்கள்/i;
const WATER_LAW_HEADING = /^water\s*law\b|நீர்\s*சட்டம்/i;
// Stays in English even inside every Tamil document checked — the corpus's
// external form links are consistently left untranslated (same pattern as
// the millets/cold-pressed-oil CTAs embedded in Category 3, which is why
// collectSubLists below drops any line starting with "Buy" rather than
// treating it as a genuine rice/fat option).
const PRODUCT_FORM_HEADING = /^buy organic food products\b/i;

const TITLE_RE = /(gear\s*\d+\s*diet chart|கியர்\s*\d+\s*உணவு\s*அட்டவணை)/i;
// The very last content in every document (134/134): a bold closing quote,
// then one or two plain paragraphs starting "Disclaimer:" (Tamil:
// "பொறுப்புத் துறப்பு:"). The schema has carried closingQuote/disclaimer
// fields since the first migration pass, but nothing ever populated them
// for the 132 auto-converted files — only the 2 hand-transcribed ones carry
// real values, entered by hand. See findClosingContent() below.
const DISCLAIMER_HEADING = /^disclaimer\s*[:：]|^பொறுப்புத்\s*துறப்பு\s*[:：]?/i;

// A gear's document covers exactly one meal — the same rule the viewer uses
// to chain gears (client/src/lib/gearChain.js).
const MEAL_BY_GEAR = { 2: 'Breakfast', 3: 'Lunch', 4: 'Dinner' };

// Markers are recognised by their WORDS, not their formatting. Bold is not a
// reliable signal for them: Gear 3's English documents invert it entirely —
// "Ingredients:" and "Instructions:" are plain while the ingredient lines
// under them are bold. Requiring bold here cost those 20 documents all but
// one recipe each, while the Tamil equivalents (bolded normally) came through
// at ~8 per document.
function isMarker(b) {
  return b.type === 'para' && !!b.text && (ING_MARKER.test(b.text) || STEP_MARKER.test(b.text));
}

function cleanName(text) {
  return text.replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\s*:\s*$/, '').trim();
}

function isDayTable(t) {
  const first = ((t.rows[0] || [])[0] || '').toLowerCase().trim();
  return t.rows.length > 1 && DAY_WORDS.some((w) => first.startsWith(w));
}

// Gear 4 opens with the Word document's own table of contents. Its page
// numbers refer to printed pages that don't exist in a tabbed app view, so
// it's navigation furniture rather than diet guidance — dropped, not kept.
function isTableOfContents(t) {
  const head = (t.rows[0] || []).join(' ').toLowerCase();
  return /page\s*number|பக்கம்\s*எண்/.test(head);
}

// How far ahead to look for a confirming marker. Some recipes (e.g. "VARAGU
// IDLI DOSA" in the Gear 4 batch) list 4-5 plain ingredient lines with no
// "Ingredients:" label before their "HOW TO MAKE ... METHOD" marker, which a
// narrower window missed entirely. Wide is safe because every lookahead
// below independently stops the instant it hits a table or another bold
// line — the window is just an outer cap, not the thing doing the real work.
const MARKER_LOOKAHEAD = 10;

// Looks ahead from `from` (exclusive) for the first ING_MARKER or
// STEP_MARKER match, stopping at a table or another bold paragraph —
// returns { at, kind } or null. Shared by the heading-confirmation step and
// the in-recipe boundary check below, so both use identical stopping rules.
function lookAheadForMarker(blocks, from, to) {
  for (let j = from; j < Math.min(to, from + MARKER_LOOKAHEAD); j++) {
    const c = blocks[j];
    if (c.type !== 'para') break;
    if (c.text && ING_MARKER.test(c.text)) return { at: j, kind: 'ing' };
    if (c.text && STEP_MARKER.test(c.text)) return { at: j, kind: 'step' };
    if (c.allBold && c.text) break;
  }
  return null;
}

// A recipe heading is a bold line followed shortly by an ingredients or
// preparation marker — but any other bold line in between means this one was
// the section heading sitting above the real recipe, not a recipe itself.
//
// Ingredient/boundary detection runs as ONE forward pass per recipe (not a
// separate "find the end" pass followed by a second "collect the content"
// pass, as this used to be) because the two questions turn out to be the
// same question asked correctly: a bold, non-marker line partway through is
// a genuinely NEW recipe's heading only if its own lookahead confirms a
// marker KIND this recipe has already used once. The first-ever occurrence
// of a kind always belongs to the current recipe, even when it's the very
// LAST bold ingredient line immediately before that marker — several
// documents (Gear 3's English salad recipes among them) bold every
// ingredient/step line while leaving "Ingredients:"/"Instructions:" plain,
// and the old two-pass version misread each such recipe's last ingredient
// line as a second recipe's name, with that recipe's own steps wrongly
// reattached to it (visible on screen as a real recipe's ingredient list
// missing its last item, immediately followed by a phantom "recipe" whose
// name IS that missing ingredient).
function findRecipes(blocks) {
  const recipes = [];
  const to = blocks.length;
  for (let i = 0; i < to; i++) {
    const b = blocks[i];
    if (b.type !== 'para' || !b.text || isMarker(b)) continue;
    // A heading is normally bold, but "Option N:" sub-headings are
    // inconsistently bolded from option to option within the same document
    // (a Diabetes Gear 4 soup section bolds Options 1/2/3/5/6 but leaves
    // Option 4 plain) — recognised by text pattern as a fallback so a
    // genuinely new recipe heading isn't skipped just because this one
    // instance wasn't bolded. Still gated by the marker lookahead just
    // below, so a plain sentence that happens to start with "Option" some
    // other way can't slip through without real ingredients/steps after it.
    if (!b.allBold && !OPTION_HEADING.test(b.text)) continue;

    const confirmed = lookAheadForMarker(blocks, i + 1, to);
    if (!confirmed) continue;

    const seen = { ing: confirmed.kind === 'ing', step: confirmed.kind === 'step' };
    const ingredients = [];
    const steps = [];
    let mode = confirmed.kind;
    let end = to;

    for (let j = i; j < to; j++) {
      const c = blocks[j];
      if (c.type === 'table') { end = j; break; }
      if (c.type !== 'para') continue;
      if (j === i || j === confirmed.at) continue; // the heading, and the marker that confirmed it

      if (c.text && ING_MARKER.test(c.text)) {
        if (seen.ing) { end = j; break; } // a second "Ingredients:" — must be a new recipe
        seen.ing = true; mode = 'ing'; continue;
      }
      if (c.text && STEP_MARKER.test(c.text)) {
        if (seen.step) { end = j; break; }
        seen.step = true; mode = 'step'; continue;
      }
      // A known zone/section heading (Kashayas, Snacks, "Dinner Recipe(s)",
      // Kanji, Thuvaiyal Recipes for Kanji, Millet Recipe, Dinner Soups
      // Recipe, Fruits — see isKnownSectionHeading above) is never recipe
      // content, checked regardless of bold or of whether a marker can be
      // confirmed after it. Without this, a recipe using only ONE marker
      // kind (e.g. a kanji porridge recipe confirmed via "Recipe:" alone)
      // can run straight through the next section's own heading line: its
      // lookahead gives up immediately because the very next line is ANOTHER
      // heading rather than a marker, so the heading text itself gets
      // swallowed in as a bogus extra step.
      if (c.text && isKnownSectionHeading(c.text)) { end = j; break; }

      if (c.text && (c.allBold || OPTION_HEADING.test(c.text))) {
        // Only a genuine new heading if ITS OWN lookahead lands on a marker
        // kind this recipe has already consumed — the first occurrence of
        // either kind is always still this recipe's own content, however
        // bold it happens to be. That rule alone under-splits a recipe that
        // only ever uses ONE marker kind (e.g. a kanji porridge recipe with
        // a "Recipe:" step marker but no "Ingredients:" of its own): its
        // seen.ing never becomes true, so a genuinely separate "Option 2:
        // ..." recipe's first-ever "Ingredients:" marker reads as still the
        // first recipe's own unseen content and gets swallowed into it. An
        // "Option N:" heading is checked on its own merits regardless of
        // `seen` (and regardless of bold, matching the outer loop above —
        // one soup section bolds Options 1/2/3/5/6 but leaves Option 4
        // plain) — that literal text pattern is specific enough to dish
        // sub-headings, never an ingredient/step sentence, that it's safe to
        // always treat as a boundary.
        const ahead = lookAheadForMarker(blocks, j + 1, to);
        if (ahead && (seen[ahead.kind] || OPTION_HEADING.test(c.text))) { end = j; break; }
      }

      if (!c.text || NOISE.test(c.text)) continue;
      if (mode === 'ing') ingredients.push(c.text);
      else if (mode === 'step') steps.push(c.text);
    }

    const images = collectRecipeImages(blocks, i, end);
    recipes.push({ name: cleanName(b.text), ingredients, steps, images, startBlock: i });
    i = end - 1;
  }
  return recipes;
}

// A recipe's own photo can sit almost anywhere in its own block range — on
// the heading line itself, on a blank paragraph immediately before OR after
// the heading, on the "Ingredients:"/"Instructions:" label line, or on any
// one of the ingredient bullet lines themselves (confirmed by direct
// inspection across several documents: one BP Gear 3 salad had its Option 1
// photo on the "Ingredients:" label, while a Diabetes Gear 3 salad had
// Option 3's photo on its FIRST ingredient bullet and Option 5's on its
// SECOND — three different documents, three different placements, none of
// them the heading). The one thing that's reliable is the boundary: `end`
// is already computed (by findRecipes()/extractStepOnlyRecipes(), passed in
// here) to exclude the NEXT recipe's own heading — so scanning the entire
// `[headingAt, end)` range for any image, wherever it is, can never
// misattribute the next recipe's own photo the way collecting inline while
// STILL SCANNING for that boundary used to (concretely: Diabetes Gear 4's
// "Option 1: Drumstick leaves Kashayam" was carrying "Option 2"'s photo,
// since the inline version read an image off whichever block happened to
// end the scan, before recognising it as the reason to stop). Called AFTER
// a recipe's `end` boundary is already finalised, which is what makes this
// safe — a leading photo on a blank line strictly BEFORE `headingAt` is the
// one case outside that range, handled by the backward scan below (Kashayas'
// own image27.png sits right after the SECTION heading and before "Option
// 1", never touching any of Option 1's own text, so it's unreachable by the
// forward scan alone).
function collectRecipeImages(blocks, headingAt, end) {
  const images = [];
  for (let p = headingAt - 1; p >= 0; p--) {
    const prev = blocks[p];
    if (prev.type !== 'para' || prev.text) break;
    if (!prev.images || !prev.images.length) break;
    images.unshift(...prev.images);
  }
  for (let j = headingAt; j < end; j++) {
    const c = blocks[j];
    if (c.type !== 'para') continue;
    if (c.images && c.images.length) images.push(...c.images);
  }
  return images;
}

// Kashaya/Kashayam recipes carry no "Ingredients:"/"Instructions:" marker at
// all — just an "Option N: <name> Kashayam" heading directly followed by
// plain step sentences ("Take ½ fistful of drumstick leaves..."). findRecipes()
// above deliberately never recognises these (loosening its marker rule would
// re-admit ordinary prose elsewhere as false recipes — see this file's header
// comment), so groupRecipes() falls back to this narrower extractor, but
// ONLY for a zone that findRecipes() found zero real recipes in: a heading
// (bold OR an "Option N"-shaped line) followed by lines up to the next such
// heading/table becomes a steps-only recipe (no separate ingredients array —
// "½ fistful of X" is just stated as the first step, same as the source
// itself never separates them).
function extractStepOnlyRecipes(blocks, from, to) {
  const isHeadingLine = (blk) => blk.type === 'para' && blk.text && (blk.allBold || OPTION_HEADING.test(blk.text));
  const recipes = [];
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (!isHeadingLine(b) || isMarker(b)) continue;
    const steps = [];
    let j = i + 1;
    for (; j < to; j++) {
      const c = blocks[j];
      if (c.type === 'table') break;
      if (c.type !== 'para') continue;
      if (isHeadingLine(c)) break;
      if (!c.text || NOISE.test(c.text)) continue;
      steps.push(c.text);
    }
    // See collectRecipeImages' own comment (below findRecipes) for why this
    // runs AFTER `j` (the recipe's own end) is already settled, rather than
    // inline while scanning above — this is the exact function that first
    // surfaced the bug it fixes (Kashayas' Option 1/2/3 photos were each one
    // recipe off from where they belonged).
    const images = collectRecipeImages(blocks, i, j);
    if (steps.length) recipes.push({ name: cleanName(b.text), ingredients: [], steps, images, startBlock: i });
    i = j - 1;
  }
  return recipes;
}

// Category 2/3's "Poriyal Options" / "Veg Option:" / "Rice Options" /
// "Healthy Fats:" are short NAME lists (dish/ingredient names, one per
// line), never full recipes — no Ingredients:/Instructions: markers at all,
// same underlying reason findRecipes() never touches Kashayam recipes
// either. Each bold sub-heading in the range becomes one readable
// "Heading: item, item, item" line rather than its own card. A stray "Buy
// Unpolished Millets..."/"Buy Natural and Organic Cold Pressed Oil..." CTA
// sometimes sits inside these same lists (see PRODUCT_FORM_HEADING above,
// its own separate section) — dropped here rather than listed as if it
// were a rice or fat option.
// `recipeStarts` — the startBlock of every already-extracted real recipe —
// is what actually bounds these two collectors, not just "the next zone".
// A freeText zone's `end` argument is the next ZONE marker, which for most
// of them (Category 2/3, and every Gear 3 zone from Cutting Types onward)
// sits close by since these zones cascade continuously to the end of the
// document. Gear 2's occasional "Salad Laws" breaks that assumption — right
// after its own 4-line body, well BEFORE the next zone (Herbal Tea, 50 blocks
// later), sit two completely unrelated breakfast recipes (Red Rice Puttu,
// Green Moong Dal Idli) that would otherwise get read as if they were part
// of the Salad Law text. Stopping at the first real recipe's own heading —
// known independently of any zone, from findRecipes()'s own output — is
// what actually caps a freeText zone to its own true short body.
// Returns `{lines, images}` — a "Poriyal Options"/"Rice Options" sub-heading
// often carries its own photo (either on the heading line itself, or on the
// "Buy Unpolished Millets..."/"Buy Natural and Organic Cold Pressed Oil..."
// CTA line embedded inside its item list), collected here even though the
// CTA's own TEXT is dropped from `items` — a group like Category 2/3 has no
// recipe of its own to hang an image field off, so this is the only place
// one can come from.
function collectSubLists(blocks, from, to, recipeStarts) {
  const lines = [];
  const images = [];
  for (let i = from; i < to; i++) {
    if (recipeStarts && recipeStarts.has(i)) break;
    const b = blocks[i];
    // Fruits Suggestions (or any other known section heading) isn't a real
    // recipe — recipeStarts alone wouldn't catch it — but it's still not
    // this zone's own content, so it stops the scan the same way.
    if (b.type === 'para' && b.text && isKnownSectionHeading(b.text)) break;
    if (b.type !== 'para' || !b.allBold || !b.text || b.text.length > 60) continue;
    if (b.images && b.images.length) images.push(...b.images);
    const heading = b.text.replace(/[:：]\s*$/, '').trim();
    const items = [];
    let j = i + 1;
    for (; j < to; j++) {
      if (recipeStarts && recipeStarts.has(j)) break;
      const c = blocks[j];
      if (c.type === 'table') break;
      if (c.type !== 'para') continue;
      if (c.allBold && c.text) break;
      if (c.text && isKnownSectionHeading(c.text)) break;
      if (c.images && c.images.length) images.push(...c.images);
      if (!c.text) continue;
      if (/^buy\b/i.test(c.text.trim())) continue;
      items.push(c.text.trim());
    }
    if (items.length) lines.push(`${heading}: ${items.join(', ')}`);
    i = j - 1;
  }
  return { lines, images };
}

// Cutting Types / Salad Law / Water Law / the product-shopping form are all
// short — a one-line heading plus a couple of plain sentences (or, for the
// form, just its own URL on the next line) — so unlike collectSubLists
// above there's no attempt to find further sub-headings inside them, just a
// straight read of every plain line up to the next zone/table/real-recipe/
// end (see the comment on collectSubLists just above for why the recipe
// boundary matters, not just the zone one).
// Returns `{lines, images}` — Cutting Types' own "Slice Chop" line and the
// Shop Organic Products URL line both carry a photo in the source; Salad Law
// and Water Law never do in any of the 22 English Gear 3 documents checked
// (confirmed by direct inspection, not assumed) — `images` legitimately
// comes back empty for those two, left for groupRecipes()'s own fuzzy-match
// fallback (build-recipe-library.js) to fill in later.
function collectZoneFreeText(blocks, from, to, recipeStarts) {
  const lines = [];
  const images = [];
  for (let j = from; j < to; j++) {
    if (recipeStarts && recipeStarts.has(j)) break;
    const c = blocks[j];
    if (c.type === 'table') break;
    if (c.type !== 'para') continue;
    // Fruits Suggestions (or any other known section heading) isn't a real
    // recipe — recipeStarts alone wouldn't catch it — but it's still not
    // this zone's own content, so it stops the scan the same way. Checked
    // BEFORE collecting images, or the next zone's own heading-embedded
    // photo (if it has one) would get stolen the instant before this loop
    // recognises it as the reason to stop.
    if (c.text && isKnownSectionHeading(c.text)) break;
    if (c.images && c.images.length) images.push(...c.images);
    if (!c.text) continue;
    lines.push(c.text.trim());
  }
  return { lines, images };
}

// Extracts the gear number a "Gear N Diet Chart" heading names, in either
// language, so it can be matched against entry.gear.
const HEADING_GEAR_NUM = /gear\s*(\d+)\s*diet chart|கியர்\s*(\d+)\s*உணவு\s*அட்டவணை/i;
function headingGearNumber(text) {
  const m = HEADING_GEAR_NUM.exec(text);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isNaN(n) ? null : n;
}

// Classifies every table in `[lo, hi)` into mealPlans/infoTables/notes,
// exactly the rules convertDoc always used — factored out so both the
// entry's own content and the shared Gear-5 preamble (see convertDoc) can
// run the identical logic over different slices of the same block array,
// with a single meaning for "day table" / "table of contents" / "callout".
function classifyTables(blocks, lo, hi, entry) {
  const mealPlans = [];
  const infoTables = [];
  const notes = [];

  for (let i = lo; i < hi; i++) {
    const b = blocks[i];
    if (b.type !== 'table' || !b.rows.length) continue;

    if (b.rows.length === 1 && b.rows[0].length === 1) {
      if (b.rows[0][0]) notes.push(b.rows[0][0]);
      continue;
    }

    // The title is the short label immediately above the table ("Weight
    // loss", "Weekly chart"). The lookback is deliberately tight: several
    // documents have no caption at all, and reaching further back just
    // grabs unrelated text (a tagline, the table of contents) and presents
    // it as the table's name. Two paragraphs, then give up. Never looks
    // before `lo` — a caption belongs to whichever slice its table is in.
    let title = '';
    let looked = 0;
    for (let j = i - 1; j >= lo && looked < 2; j--) {
      const p = blocks[j];
      if (p.type !== 'para') break;
      if (!p.text) continue; // image-only paragraphs don't count against the budget
      looked++;
      const t = p.text.replace(/\s*:\s*$/, '').trim();
      if (TITLE_RE.test(t) || /^["“”']/.test(t) || t.length > 60) continue;
      title = t;
      break;
    }

    if (isDayTable(b)) {
      mealPlans.push({
        // With no caption in the source, the meal this gear covers is a more
        // useful name than a generic one.
        title: title || MEAL_BY_GEAR[entry.gear] || 'Diet Chart',
        columns: b.rows[0],
        rows: b.rows.slice(1).map((r) => ({ day: r[0], cells: r.slice(1) })),
      });
    } else if (!isTableOfContents(b)) {
      // Gear 4 in particular carries real content in non-day tables (Do's and
      // Don'ts, Restrict/Reduce/Replace, the daily routine). Dropping them
      // would silently lose guidance, so they're kept as their own kind.
      infoTables.push({ title: title || undefined, columns: b.rows[0], rows: b.rows.slice(1) });
    }
  }

  return { mealPlans, infoTables, notes };
}

// Named zones a recipe can fall into by simple position — the nearest
// zone-heading at or before its own heading, among ALL of these combined.
// This replaces the old by-NAME "isTea" rule (a recipe belonged to Herbal
// Tea only if its own dish name contained the word "tea") with a by-
// POSITION one: not just more robust (a Kashayam recipe has no "tea" in its
// name and previously had nowhere principled to land), it's also what
// actually reproduces Gear 4's real section breaks — Kashayas, Snacks,
// and within "Dinner Recipes": Kanji, Thuvaiyal Recipes (for the kanji),
// Dinner Millet Recipes, Dinner Soups Recipe. Gear 2/3 documents contain
// none of these headings, so nothing here fires for them and every recipe
// still falls through to the single "Recipes" bucket exactly as before.
// Most documents label the kanji porridge recipe itself with its own bold
// "Kanji:" heading, directly under the "Dinner Recipes" wrapper a couple of
// blocks above it. Kidney's English document skips that inner heading
// entirely — the wrapper is immediately followed by the porridge recipe
// itself ("Little Millet / Kodo Millet / Barnyard / Foxtail...") with no
// "Kanji:" line in between at all, which used to leave that recipe stranded
// in whatever zone preceded it (Snacks). Matching the wrapper heading too —
// not just the inner one — means the wrapper always opens the Kanji zone,
// whether or not the document also bothers with the more specific label.
const DINNER_WRAPPER_HEADING = /^dinner\s*recipes?\b|இரவு\s*உணவு\s*வகைகள்/i;
const ZONE_PATTERNS = [
  [TEA_HEADING, 'Herbal Tea'],
  [KASHAYA_HEADING, 'Kashayas'],
  [SNACKS_HEADING, 'Snacks'],
  [DINNER_WRAPPER_HEADING, 'Kanji'],
  [KANJI_HEADING, 'Kanji'],
  [THUVAIYAL_HEADING, 'Thuvaiyal Recipes for Kanji'],
  [MILLET_HEADING, 'Millet Recipe'],
  [SOUPS_HEADING, 'Dinner Soups Recipe'],
  [CATEGORY1_HEADING, 'Category 1'],
  [SALAD_RECIPES_HEADING, 'Category 1'],
  [CATEGORY2_HEADING, 'Category 2'],
  [CATEGORY3_HEADING, 'Category 3'],
  [CUTTING_TYPES_HEADING, 'Cutting Types'],
  [PRODUCT_FORM_HEADING, 'Shop Organic Products'],
  [SALAD_LAW_HEADING, 'Salad Law'],
  [WATER_LAW_HEADING, 'Water Law'],
];
// Category 2/3, Cutting Types, the shopping form, and both Laws never carry
// real recipes — findRecipes() has nothing to find there (no Ingredients:/
// Instructions: markers), so unlike Kashayas these zones skip the
// steps-only-recipe fallback entirely and go straight to freeText. Category
// 2/3 specifically use collectSubLists (each has 2 named item lists nested
// inside it — Poriyal/Veg Option, Rice/Healthy Fats); the rest use the
// simpler collectZoneFreeText (a heading plus a few plain sentences, or one
// link).
const FREETEXT_ZONE_HEADINGS = new Set(['Category 2', 'Category 3', 'Cutting Types', 'Shop Organic Products', 'Salad Law', 'Water Law']);
const SUBLIST_ZONE_HEADINGS = new Set(['Category 2', 'Category 3']);

// A recipe that only ever uses ONE marker kind (the kanji porridge recipe
// above, confirmed via "Recipe:" alone) can run straight through a genuine
// zone-heading line like "Thuvaiyal Recipes for kanji" without stopping: its
// own lookAheadForMarker gives up immediately, because the very next line is
// ANOTHER bold heading ("Option 1: ...") rather than a marker — so the
// zone-heading text itself gets swallowed in as a bogus extra step. These
// zone headings are already known by name (they're exactly what groupRecipes
// below uses to split Gear 4's tabs), so findRecipes() checks a candidate
// boundary line against them directly, as a NOISE-like signal that's true
// regardless of what marker (if any) follows.
function isKnownSectionHeading(text) {
  return ZONE_PATTERNS.some(([pattern]) => pattern.test(text)) || FRUIT_HEADING.test(text);
}
// Kanji / Thuvaiyal Recipes for Kanji / Millet Recipe aren't siblings of
// Kashayas/Snacks/Herbal Tea — the source document nests all three under its
// own "Dinner Recipes" heading, and the app's tab layout preserves that: they
// render as sub-groups inside one "Dinner Recipe" tab rather than three more
// top-level tabs. Kidney's document has no Millet section at all, so this
// list only ever contains however many of the three actually matched.
const DINNER_RECIPE_SUBZONES = ['Kanji', 'Thuvaiyal Recipes for Kanji', 'Millet Recipe'];
// Tab order follows the source document's own flow (Kashayas and Snacks
// before Herbal Tea in most conditions, Herbal Tea first in Kidney's — the
// order below is the common case, not a hard requirement; a document that
// orders them differently still gets every zone correctly split, just
// listed in this fixed order rather than re-sorted to match that one file).
const ZONE_ORDER = [
  'Category 1', 'Category 2', 'Category 3',
  'Kashayas', 'Snacks', 'Herbal Tea', 'Dinner Recipe', 'Dinner Soups Recipe',
  'Cutting Types', 'Shop Organic Products', 'Salad Law', 'Water Law',
];

// Zone headings are matched against the WHOLE paragraph text regardless of
// bold — "Dinner - Soups Recipe" and its Tamil equivalent are plain text in
// several documents, only "Dinner Millet Recipes" and most of the others
// are bold. The length cap keeps a heading match from accidentally landing
// mid-sentence in some unrelated long paragraph — raised from the original
// 60 to fit Category 3's own heading, which runs up to 133 characters in
// Tamil ("Category 3 - Complex carbohydrates + Healthy protein + Healthy
// fats - Unpolished Rice + Non Veg + Fat" and its Tamil equivalent) without
// itself being a run-on sentence — still tight enough that the very specific
// prefix each ZONE_PATTERNS entry requires (e.g. "category 3", "water law")
// can't realistically land mid-sentence in unrelated prose.
function findZones(blocks, lo, hi) {
  const zones = [];
  for (let i = lo; i < hi; i++) {
    const b = blocks[i];
    if (b.type !== 'para' || !b.text || b.text.length > 150) continue;
    for (const [pattern, heading] of ZONE_PATTERNS) {
      if (pattern.test(b.text)) { zones.push({ at: i, heading }); break; }
    }
  }
  return zones;
}

// Groups the recipes found in `[lo, hi)` into the app's own section layout —
// Vegetable Preparation and Fruits/Nuts stay their own special cases (by
// recipe NAME, not position — "Nuts:" alone carries no useful zone
// boundary), everything else is either a named zone (see above) or falls
// into a single generic "Recipes" bucket, matching Gear 2/3 exactly as
// before since they have no zone headings at all.
function groupRecipes(blocks, all, lo, hi) {
  const inRange = all.filter((r) => r.startBlock >= lo && r.startBlock < hi);
  const recipeStarts = new Set(inRange.map((r) => r.startBlock));

  // Fruit is a bold "Fruits Suggestions"/"Fruits Law" line, not a recipe — it
  // has no ingredients/preparation markers of its own. Its content shape
  // differs by which one it is (see FRUIT_LAW_HEADING above): Gear 2/3
  // becomes a fake recipe-shaped card so it displays like the others (and can
  // still merge with Nuts into "Fruits & Nuts"); Gear 4's Law becomes its own
  // plain-guideline group directly, appended after every zone below to match
  // the order the user asked for.
  const fruitAt = indexOfFirst(blocks, lo, hi, (b, i) => b.type === 'para' && b.allBold && b.text
    && FRUIT_HEADING.test(b.text) && !inRange.some((r) => r.startBlock === i));
  let fruit = null;
  let fruitLawGroup = null;
  if (fruitAt !== -1) {
    const lines = [];
    for (let j = fruitAt + 1; j < Math.min(hi, fruitAt + 8); j++) {
      const c = blocks[j];
      if (c.type !== 'para' || !c.text) break;
      if (inRange.some((r) => r.startBlock === j)) break;
      lines.push(c.text.replace(/^[-–•]\s*/, ''));
    }
    if (lines.length) {
      if (FRUIT_LAW_HEADING.test(blocks[fruitAt].text)) {
        fruitLawGroup = { heading: 'Fruits', freeText: lines };
      } else {
        const varieties = lines[0].split(/\s*\/\s*/)
          .map((s) => s.replace(/\s*[-–—]\s*whole fruit\.?$/i, '').trim())
          .filter(Boolean);
        fruit = { name: 'Fruits', ingredients: varieties, note: lines.slice(1).join(' ') || undefined, images: [] };
      }
    }
  }

  const groups = [];
  const prep = inRange.filter((r) => LEACH_NAME.test(r.name));
  if (prep.length) groups.push({ heading: 'Vegetable Preparation', recipes: prep });

  const nuts = inRange.filter((r) => NUTS_NAME.test(r.name));
  const rest = inRange.filter((r) => !LEACH_NAME.test(r.name) && !NUTS_NAME.test(r.name));

  const zones = findZones(blocks, lo, hi);
  // A freeText-only zone (Category 2/3, Cutting Types, Salad Law, Water Law,
  // the shopping form — see FREETEXT_ZONE_HEADINGS) never has recipes of its
  // own by design, but every Gear 4 zone so far has always been followed by
  // ANOTHER real zone all the way to the end of the document — nothing ever
  // needed to "expire". Gear 2's own occasional "Salad Laws" section breaks
  // that assumption: it sits mid-document with ordinary breakfast recipes
  // (Red Rice Puttu, Green Moong Dal Idli) still to come before Herbal Tea,
  // and without this guard those recipes would wrongly zone to Salad Law —
  // the nearest PRECEDING zone marker, whatever it is — for lack of anything
  // in between to reset it. Skipping freeText-only zones here means they
  // stay invisible to REAL recipe assignment while still getting their own
  // freeText further down (via the separate zones.forEach loop below).
  function zoneFor(startBlock) {
    let heading = null;
    for (const z of zones) {
      if (z.at > startBlock) break;
      if (FREETEXT_ZONE_HEADINGS.has(z.heading)) continue;
      heading = z.heading;
    }
    return heading;
  }

  const main = [];
  const byZone = new Map();
  for (const r of rest) {
    const zone = zoneFor(r.startBlock);
    if (!zone) { main.push(r); continue; }
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push(r);
  }

  // A zone findRecipes() found NOTHING in falls back to one of two things,
  // scoped tightly to that zone's own block range so it can never reach
  // into a neighboring zone's content: Kashayas-style zones (no recipes, but
  // genuine dish content) get the steps-only recipe fallback; Category 2/3,
  // Cutting Types, Salad Law, Water Law and the shopping form NEVER have
  // real recipes at all (see FREETEXT_ZONE_HEADINGS above) and go straight
  // to freeText instead.
  const freeTextZones = new Map();
  zones.forEach((z, idx) => {
    const end = idx + 1 < zones.length ? zones[idx + 1].at : hi;
    if (FREETEXT_ZONE_HEADINGS.has(z.heading)) {
      if (freeTextZones.has(z.heading)) return;
      const intro = blocks[z.at].text.trim();
      const { lines: body, images: bodyImages } = SUBLIST_ZONE_HEADINGS.has(z.heading)
        ? collectSubLists(blocks, z.at + 1, end, recipeStarts)
        : collectZoneFreeText(blocks, z.at + 1, end, recipeStarts);
      const text = [intro, ...body].filter(Boolean);
      // The zone-triggering heading itself (e.g. "Buy Organic Food products
      // in our own True Food Store:") can carry its own image too, on top of
      // whatever collectSubLists/collectZoneFreeText found further in.
      const images = [...((blocks[z.at].images && blocks[z.at].images) || []), ...bodyImages];
      if (text.length) freeTextZones.set(z.heading, { text, images });
      return;
    }
    if (byZone.has(z.heading)) return;
    const fallback = extractStepOnlyRecipes(blocks, z.at + 1, end);
    if (fallback.length) byZone.set(z.heading, fallback);
  });
  if (main.length) groups.push({ heading: 'Recipes', recipes: main });

  const fruitNuts = [...(fruit ? [fruit] : []), ...nuts];
  if (fruitNuts.length) {
    groups.push({ heading: fruit && fruitNuts.length > 1 ? 'Fruits & Nuts' : (fruit ? 'Fruits' : 'Nuts'), recipes: fruitNuts });
  }

  // Category 1's own descriptive heading text ("Category 1: Vitamins &
  // Minerals - Salads") sits far EARLIER than its real recipes (the Salad
  // recipes Option 1..N cards, reached via the SALAD_RECIPES_HEADING zone
  // trigger above) — found independently here since it's a different
  // occurrence of the same zone than the one byZone/freeTextZones ended up
  // keyed by, and folded into the same tab as a lead-in line rather than
  // becoming a whole separate group.
  const category1IntroAt = indexOfFirst(blocks, lo, hi, (b) => b.type === 'para' && b.text && CATEGORY1_HEADING.test(b.text));
  const category1Intro = category1IntroAt !== -1 ? blocks[category1IntroAt].text.trim() : null;

  for (const heading of ZONE_ORDER) {
    if (heading === 'Dinner Recipe') {
      const subGroups = DINNER_RECIPE_SUBZONES
        .filter((h) => byZone.has(h))
        .map((h) => ({ heading: h, recipes: byZone.get(h) }));
      if (subGroups.length) groups.push({ heading: 'Dinner Recipe', subGroups });
      continue;
    }
    if (heading === 'Category 1' && byZone.has(heading)) {
      const group = { heading, recipes: byZone.get(heading) };
      if (category1Intro) group.freeText = [category1Intro];
      groups.push(group);
      continue;
    }
    if (byZone.has(heading)) { groups.push({ heading, recipes: byZone.get(heading) }); continue; }
    if (freeTextZones.has(heading)) {
      const { text, images } = freeTextZones.get(heading);
      // `images` is the same raw internal shape a recipe's own `images`
      // field starts as — resolved into a single `image` (or, for Salad
      // Law/Water Law, which never have one anywhere in the corpus,
      // fuzzy-matched against the recipe library instead) by migrate-all.js
      // / build-recipe-library.js, same as every recipe's own photo.
      groups.push({ heading, freeText: text, images });
      continue;
    }
  }

  if (fruitLawGroup) groups.push(fruitLawGroup);

  return groups;
}

// blocks.findIndex bounded to [lo, hi) — used instead of a plain findIndex
// so a marker that happens to also appear in the OTHER slice (unobserved so
// far, but not provably impossible) can never be picked up by mistake.
function indexOfFirst(blocks, lo, hi, pred) {
  for (let i = lo; i < hi; i++) if (pred(blocks[i], i)) return i;
  return -1;
}

// Finds the closing quote + disclaimer every document ends with (see
// DISCLAIMER_HEADING above), and the block index right before them —
// `contentEnd` — so callers can exclude this tail from the main content
// range entirely. Without that exclusion, whichever zone happens to be last
// in a given document (Water Law for Gear 3, Fruits for Gear 4) would run
// all the way to the literal end of the file and swallow the quote and the
// start of the disclaimer into its own freeText — confirmed this was
// already happening to Gear 4's Fruits group before this fix (its freeText
// carried 7 lines: the 5 real "Fruits Law" sentences plus the quote and the
// first line of the disclaimer).
function findClosingContent(blocks) {
  const discAt = blocks.findIndex((b) => b.type === 'para' && b.text && DISCLAIMER_HEADING.test(b.text));
  if (discAt === -1) return { closingQuote: undefined, disclaimer: undefined, contentEnd: blocks.length };
  const discLines = [];
  for (let j = discAt; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.type !== 'para' || !b.text) break;
    discLines.push(b.text.replace(DISCLAIMER_HEADING, '').trim());
  }
  const disclaimer = discLines.filter(Boolean).join(' ').trim() || undefined;
  let closingQuote;
  let contentEnd = discAt;
  for (let j = discAt - 1; j >= Math.max(0, discAt - 4); j--) {
    const b = blocks[j];
    if (b.type !== 'para') continue;
    if (b.allBold && b.text) { closingQuote = b.text; contentEnd = j; break; }
    if (b.text) break; // hit unrelated content first — give up, keep contentEnd at discAt
  }
  return { closingQuote, disclaimer, contentEnd };
}

function convertDoc(blocks, entry) {
  // EVERY Gear 4 document in this source set (English and Tamil alike, 92 of
  // 92 checked) bundles a "Gear 5 Diet Chart" section — a general
  // routine/fasting-rules/RRR-food-chart preamble, not specific to any
  // condition or diet type — immediately before its own "Gear 4 Diet Chart"
  // section. The first "gear N diet chart" heading in the document is
  // therefore NOT reliably this entry's own title; the heading whose N
  // matches entry.gear is. Gear 2/3 documents have only one such heading, so
  // this is a no-op for them.
  const titleCandidates = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.type === 'para' && b.text && TITLE_RE.test(b.text));
  const titleMatch = titleCandidates.find(({ b }) => headingGearNumber(b.text) === entry.gear) || titleCandidates[0];
  const titleIdx = titleMatch ? titleMatch.i : 0;
  const titleBlock = titleMatch ? titleMatch.b : null;
  const next = titleMatch ? blocks[titleIdx + 1] : null;
  const tagline = next && next.type === 'para' && next.text && !TITLE_RE.test(next.text) ? next.text : undefined;

  // The Gear 5 heading, if present, always sits BEFORE this entry's own
  // heading (it's a shared preamble, never content specific to one gear) —
  // guarding on that order means a document with no such heading, or where
  // entry.gear's own heading happens to be first (Gear 2/3), is simply a
  // no-op here rather than needing a separate code path.
  const gear5Match = titleCandidates.find(({ b, i }) => headingGearNumber(b.text) === 5 && i < titleIdx);
  const gear5Idx = gear5Match ? gear5Match.i : -1;

  const all = findRecipes(blocks);
  const mainStart = titleIdx;

  // Excludes the trailing closing-quote/disclaimer block from the main
  // content range — see findClosingContent's own comment for why (a zone
  // like Water Law, or Gear 4's Fruits, would otherwise swallow them).
  const { closingQuote, disclaimer, contentEnd } = findClosingContent(blocks);
  const mainEnd = Math.min(blocks.length, contentEnd);

  const { mealPlans, infoTables, notes } = classifyTables(blocks, mainStart, mainEnd, entry);
  const recipeGroups = groupRecipes(blocks, all, mainStart, mainEnd);

  // General Guidelines: the shared "Gear 5" content — daily routine, fasting
  // rules, RRR food chart — that the management document's own table of
  // contents lists under EVERY gear, not just whichever gear's document it
  // happened to be transcribed into. Kept as its own top-level section
  // (never folded into `infoTables` above) so the client can show it
  // regardless of which single gear's chain is open — see
  // client/src/components/GearViewer.jsx.
  let generalGuidelines;
  if (gear5Idx !== -1) {
    const ggNext = blocks[gear5Idx + 1];
    const ggTagline = ggNext && ggNext.type === 'para' && ggNext.text && !TITLE_RE.test(ggNext.text) ? ggNext.text : undefined;
    const ggTables = classifyTables(blocks, gear5Idx, mainStart, entry);
    const ggGroups = groupRecipes(blocks, all, gear5Idx, mainStart);
    generalGuidelines = {
      title: blocks[gear5Idx].text,
      tagline: ggTagline,
      ...ggTables,
      recipeGroups: ggGroups,
    };
  }

  return {
    meta: {
      condition: entry.condition,
      comorbid: entry.comorbid || undefined,
      gear: entry.gear,
      dietType: entry.dietType,
      language: entry.language,
      title: titleBlock ? titleBlock.text : `Gear ${entry.gear} Diet Chart`,
      tagline,
      // Tables are verified; recipes are a machine draft until reviewed.
      recipesReviewed: false,
    },
    mealPlans,
    infoTables,
    notes,
    recipeGroups,
    generalGuidelines,
    closingQuote,
    disclaimer,
  };
}

module.exports = { convertDoc, findRecipes, cleanName, isDayTable };
