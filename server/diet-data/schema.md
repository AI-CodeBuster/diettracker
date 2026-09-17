# Diet plan data schema

A diet-plan document, extracted from the existing `.docx` templates into structured
JSON. One file per condition/gear/diet-type/language combination (matching the
existing `server/content/<CONDITION>/GEAR <N>/*.docx` layout), e.g.
`diabetes-gear2-nonveg-eng.json`.

The renderer (`client/src/components/DietTemplateView.jsx`) lays this out with plain
CSS tables and flowing text — it reflows to fit whatever content is present, so
editing a field (a longer dish name, an extra ingredient, a rewritten step) can never
overlap or misalign the rest of the page the way editing the fixed-position Word
table did.

```ts
{
  meta: {
    condition: string,       // "DIABETES" | "THYROID" | "KIDNEY DIET" | "GASTRIC -ULCER-ACIDITY DIET"
    gear: 2 | 3 | 4,
    dietType: "VEG" | "NONVEG" | "EGG",
    language: "ENG" | "TAM",
    title: string,            // page heading, e.g. "Gear 2 Diet Chart"
    // false = recipes are an unreviewed machine draft from
    // scripts/migrate-all.js and the viewer shows a warning banner; true =
    // a human has checked them against the source .docx. Meal and info
    // tables are verbatim either way. Absent counts as reviewed.
    recipesReviewed?: boolean,
    tagline?: string,         // the quoted line under the title
  },

  // The day-by-day plan table(s). Most gears have one table per weight goal
  // (e.g. "Weight loss" / "Weight gain"); a gear with only one plan just has
  // one entry here.
  mealPlans: [
    {
      title: string,          // "Weight loss"
      columns: string[],      // ["Day", "Breakfast", "Herbal Tea (Evening)"] — column 0 is always the day label
      rows: [
        { day: string, cells: string[] }   // cells.length === columns.length - 1, one per non-Day column
      ],
    },
  ],

  // Non-day tables the source carries alongside the schedule — Gear 4's Do's
  // and Don'ts, Restrict/Reduce/Replace, the daily routine. Same shape as a
  // mealPlan but its rows are plain cell arrays, with no day column pulled
  // out front. Word's own table of contents is dropped, not kept here.
  infoTables?: [
    { title?: string, columns: string[], rows: string[][] }
  ],

  notes?: string[],           // short callouts shown right under the table(s)

  // A diagram OF THE MEAL ITSELF, shown on the Diet Schedule tab under the
  // table(s) — Gear 2's "BMW BREAKFAST" plate chart (veggies 40% / legumes
  // 40% / eggs 10% / complex carbs 10%). It explains how to build any day's
  // breakfast, so it belongs to the schedule and not to any one recipe;
  // it used to sit on the "Recipes" group's own `image` and read there as an
  // unexplained photo above an unrelated dish list. Rendered by
  // .diet-schedule-image, which — unlike the cropped .diet-group-image
  // thumbnails — shows the whole image, since its labels are the content.
  scheduleImage?: string,

  // Reference material the table's dish names point to. Grouping follows the
  // source document's OWN category structure where it genuinely has one, and
  // falls back to a single "Recipes" bucket where it doesn't: Gear 2 really
  // is just one undifferentiated breakfast recipe list under the hood (fruit
  // and nuts share "Fruits & Nuts", "Herbal Tea" stays separate, and the
  // source's "Salad essentials" heading is dropped — its recipes moved into
  // "Recipes" and its Salad Laws/Rules text became that group's footNotes).
  // Gear 3 and Gear 4 both DO keep their own named sections, because each
  // genuinely has distinct dish/content categories the patient chooses
  // between or is meant to read as separate guidance (a kashayam is not
  // interchangeable with a soup; Category 2's Poriyal suggestions aren't the
  // same thing as Category 1's salads) — the exact heading set differs by
  // gear:
  //   Gear 3: "Category 1" (Vitamins & Minerals - Salads — the ONLY Gear 3
  //     category with real recipes, the Salad Option cards; the other two
  //     are short suggestion-name lists, never full recipes), "Category 2"
  //     (Fibre - Veggies: Poriyal/Kootu/Veg Kuzhambu options), "Category 3"
  //     (Complex carbs + protein + fats: Rice/Healthy Fats options — wording
  //     of all three varies by diet type, e.g. "+ Non Veg + Fat" only on
  //     non-veg documents), "Cutting Types", "Shop Organic Products" (the
  //     product-buying form link), "Salad Law", "Water Law".
  //   Gear 4: "Kashayas", "Snacks", "Herbal Tea", "Dinner Recipe" (itself
  //     split into `subGroups` — Kanji, Thuvaiyal Recipes for Kanji, Millet
  //     Recipe — matching how the source nests them under its own "Dinner
  //     Recipes" heading), "Dinner Soups Recipe", "Fruits" (freeText — Gear
  //     4's own "Fruits Law" heading holds guideline sentences, not a
  //     variety list, unlike Gear 2/3's "Fruits Suggestions").
  // A small number of Gear 2 documents (Diabetes/Thyroid, VEG only) also
  // happen to carry a bare "Salad Laws" section of their own, unrelated to
  // Gear 3's Category structure — extracted the same way since the
  // underlying mechanism is gear-agnostic, not because Gear 2 is expected to
  // have one. Wording and presence vary across the corpus for every one of
  // these (Kidney's Gear 4 has no separate Millet section at all); a heading
  // that doesn't appear in a given document is simply absent from
  // `recipeGroups`, never emitted empty. Migrate new documents by matching
  // whichever pattern (a single flat list, or the gear's own named
  // categories) that gear's source documents actually use — never invent a
  // grouping the source doesn't have.
  // Fruit is written as a recipe (name/ingredients/note/image), not freeText,
  // because only a recipe can carry an `image` — except Gear 4's "Fruits Law",
  // which is guideline prose with no varieties or image at all, so it's a
  // plain freeText group instead.
  recipeGroups: [
    {
      heading: string,        // "Recipes", "Fruits & Nuts", "Kashayas", "Category 2", "Dinner Recipe", ...
      recipes?: [
        { name: string, ingredients?: string[], steps?: string[], note?: string, image?: string, alternates?: [...same shape as a recipe] }
      ],
      // Paragraphs/bullets that aren't a single named recipe — a guideline
      // blurb (Salad/Water Law, Gear 4's "Fruits Law"), a "Heading: item,
      // item" line built from a short suggestion-name list (Category 2/3),
      // or a heading+link line (Shop Organic Products — rendered as a real
      // clickable link client-side, see DietTemplateView.jsx's Linkify).
      // Category 1 is the one group that carries BOTH `recipes` (the real
      // Salad Option cards) AND `freeText` (its own one-line category
      // description) at once.
      freeText?: string[],
      // Trailing counterpart to `freeText`: guidance that qualifies the
      // recipes above it and so is read AFTER them — Gear 2's Salad
      // Laws/Rules under the breakfast recipes, Herbal Tea's "Important
      // Note:" planting paragraphs under the tea options. Rendered last in
      // the group, which puts it directly above the closing quote and
      // disclaimer. Kept as its own field rather than a position flag on
      // `freeText` because one group can need both at once: Herbal Tea's
      // "(consumed in the evening)" line still leads in while its Important
      // Notes sit at the bottom, and Category 1's one-line description must
      // keep leading in untouched.
      footNotes?: string[],
      // A freeText-only group has no recipe card to carry a photo, so it can
      // carry one directly instead — its own source photo where the
      // document actually had one (Category 2/3, Cutting Types, Shop
      // Organic Products all do), or, for the two that never do anywhere in
      // the corpus (Salad Law, Water Law), the closest-matching real
      // recipe's photo — picked by fuzzy word-overlap against the whole
      // cross-corpus recipe library, same technique server/index.js uses to
      // give an AI-suggested recipe a plausible photo (see lib/nameMatch.js,
      // scripts/build-recipe-library.js's backfillGroupImages). Category 1
      // never sets this — its own recipe cards already carry their own
      // photos, a second one on the group itself would be redundant.
      image?: string,
      // Only on Gear 4's "Dinner Recipe" group — sub-sections nested under
      // one heading instead of flat siblings, same {heading, recipes} shape
      // recursively (never nested more than this one level deep).
      subGroups?: [
        { heading: string, recipes: [...same recipe shape as above] }
      ],
    },
  ],

  // Every document ends the same way — a bold closing quote, then one or two
  // plain paragraphs starting "Disclaimer:" (Tamil: "பொறுப்புத் துறப்பு:") —
  // extracted from the very end of the source .docx, not scoped to one gear.
  // Populated for all 134 files as of the pass that added Gear 3's own
  // Category/Law/Cutting-Types groups below, not just the 2 hand-verified
  // ones that used to be the only files carrying real values here.
  closingQuote?: string,
  disclaimer?: string,

  // Every Gear 4 source document (English and Tamil alike) bundles a "Gear 5
  // Diet Chart" section — general routine/fasting-rules/RRR-food-chart
  // guidance, not specific to this gear's own meal — immediately before its
  // own Gear 4 content. The management document's own table of contents
  // lists "Gear 5 General Guidelines" under EVERY gear, not just Gear 4, so
  // this is kept as its own section rather than folded into `infoTables`
  // above: the client fetches it once per condition and shows it alongside
  // whichever gear chain (2, 3, or 4) the patient actually opened. Present
  // only on Gear 4 files that had the heading; absent on Gear 2/3 files and
  // on any Gear 4 file where it wasn't found.
  generalGuidelines?: {
    title: string,           // "Gear 5 Diet Chart" (or the Tamil equivalent)
    tagline?: string,
    mealPlans: [ /* same shape as mealPlans above */ ],
    infoTables: [ /* same shape as infoTables above */ ],
    notes: string[],
    recipeGroups: [ /* same shape as recipeGroups above */ ],
  },
}
```

## Why this shape

- **`mealPlans[].rows[].cells` line up with `columns`** so the renderer never
  hardcodes "Breakfast" / "Herbal Tea" — a gear whose table has different columns
  (Lunch, Dinner, Snacks, ...) just supplies a different `columns` array and the
  same table component renders it.
- **Dish names in the table stay plain strings**, not references into
  `recipeGroups` — matching the source documents, where a table cell and its
  recipe heading are simply written with the same words but nothing formally
  links them. A future pass could turn this into real cross-references (so
  renaming a recipe updates every table cell that names it) once there's a
  reason to.
- **`recipeGroups` is deliberately loose** (`recipes` and/or `freeText`) because
  the source documents mix strict step-by-step recipes with looser reference
  material (fruit suggestions, "Salad Laws", planting instructions) under the
  same headings — forcing everything into one shape would either lose content
  or invent structure the source never had.
- **`recipe.image` is optional and currently unused by every migrated file.**
  The source `.docx` files do have food photos, but they're positioned right
  after each recipe's own heading, so they'd be straightforward to pull out —
  except at least one is watermarked from a third-party recipe site
  (tarladalal.com), and the rest match the same stock-photography look. That's
  someone else's copyrighted material, privately used inside a Word doc today;
  publishing it from a live app is a different, bigger step, so none were
  extracted. The field exists so a real photo (yours, licensed, or otherwise
  cleared) can be dropped in per recipe without any schema or renderer change.
- **`recipe.alternates` is optional and unused for the same reason `image` is:
  no data exists for it yet.** The intended use is a substitution — swapping a
  recipe for a patient's allergy, dislike, or blood-report finding — done as a
  clean data swap (replace one recipe object with another) instead of the old
  raw-.docx text splice, which is exactly the mechanism that caused the
  missing-word/overlap/alignment bugs this migration exists to fix.
