// Splices a patient's saved recipe replacements/additions/removals into one
// gear's diet-template data before it's rendered — a pure data transform,
// not a component, so GearViewer can apply it the same way regardless of
// which meal section a card happens to live in (main recipeGroups or
// generalGuidelines' — a recipe_id is looked up the same way either place).
//
// `overridesById` maps originalRecipeId -> the new recipe's full content
// (already resolved from the library — see GearViewer, which fetches each
// override target via GET /api/recipe/:id since the saved override itself
// only stores ids, not content). A recipe with no matching override, or
// with no recipe_id at all (only possible for hand-authored data that
// predates build-recipe-library.js), passes through unchanged.
//
// `removedIds` is a Set of recipe_ids to drop from the plan entirely (see
// [Remove] — GearViewer's removeRecipe) — checked first, so a removed
// slot's own replacement (if any) never gets a chance to render either.
// Returns null for a removed recipe, filtered out by swapGroups below.
function swapRecipe(recipe, overridesById, removedIds) {
  if (removedIds && recipe.recipe_id && removedIds.has(recipe.recipe_id)) return null;
  if (!recipe.recipe_id || !overridesById.has(recipe.recipe_id)) return recipe;
  const replacement = overridesById.get(recipe.recipe_id);
  // The replacement becomes this slot's new content, but keeps its own
  // recipe_id so a second replace-in-a-row still finds it (and so the
  // original id is preserved for [Undo], not yet built but worth not
  // foreclosing) — see originalRecipeId on the returned object.
  return {
    name: replacement.name,
    ingredients: replacement.ingredients,
    steps: replacement.steps,
    note: replacement.note,
    image: replacement.image,
    recipe_id: replacement.recipe_id,
    originalRecipeId: recipe.recipe_id,
  };
}

// A group like Gear 4's "Dinner Recipe" carries no `recipes` of its own —
// Kanji / Thuvaiyal Recipes for Kanji / Millet Recipe are nested one level
// down in `subGroups` instead (see server/scripts/lib/convertDoc.js and
// diet-data/schema.md) — so a saved replacement for one of those recipes has
// to be spliced in there too, or [Replace]/[Revert] would persist correctly
// but never actually show up on screen for anything under that tab.
function swapGroups(groups, overridesById, removedIds) {
  if (!groups || !groups.length) return groups;
  return groups.map((g) => ({
    ...g,
    recipes: g.recipes ? g.recipes.map((r) => swapRecipe(r, overridesById, removedIds)).filter(Boolean) : g.recipes,
    subGroups: g.subGroups
      ? g.subGroups.map((sub) => ({
        ...sub,
        recipes: (sub.recipes || []).map((r) => swapRecipe(r, overridesById, removedIds)).filter(Boolean),
      }))
      : g.subGroups,
  }));
}

// A dietitian-added recipe (see AddRecipeModal / [+ Add Recipe]) lands in
// whichever category tab was actually open when they clicked it — Recipes,
// Herbal Tea, Kashayas, whatever — carried alongside the recipe itself as
// `groupHeading` (see GearViewer's addRecipe). A group with that heading
// already exists by construction (the coach was just looking at it), but
// this still creates one if it somehow doesn't, falling back to a generic
// bucket only when no groupHeading was given at all. Kept out of
// generalGuidelines entirely: additions are scoped to the meal the coach
// was looking at, never to the shared Gear 4 guidance section (see
// DietTemplateView/MealSection).
const ADDED_RECIPES_HEADING = 'Added Recipes';

function addRecipesToGroups(groups, additions) {
  if (!additions || !additions.length) return groups;
  let existing = groups || [];
  for (const { recipe, groupHeading } of additions) {
    const heading = groupHeading || ADDED_RECIPES_HEADING;
    const idx = existing.findIndex((g) => g.heading === heading);
    existing = idx === -1
      ? [...existing, { heading, recipes: [recipe] }]
      : existing.map((g, i) => (i === idx ? { ...g, recipes: [...(g.recipes || []), recipe] } : g));
  }
  return existing;
}

function applyRecipeOverrides(data, overridesById, additions, removedIds) {
  const hasReplacements = overridesById && overridesById.size;
  const hasAdditions = additions && additions.length;
  const hasRemovals = removedIds && removedIds.size;
  if (!hasReplacements && !hasAdditions && !hasRemovals) return data;
  const swapped = (hasReplacements || hasRemovals) ? swapGroups(data.recipeGroups, overridesById, removedIds) : data.recipeGroups;
  return {
    ...data,
    recipeGroups: hasAdditions ? addRecipesToGroups(swapped, additions) : swapped,
    generalGuidelines: (hasReplacements || hasRemovals) && data.generalGuidelines
      ? { ...data.generalGuidelines, recipeGroups: swapGroups(data.generalGuidelines.recipeGroups, overridesById, removedIds) }
      : data.generalGuidelines,
  };
}

export { applyRecipeOverrides, ADDED_RECIPES_HEADING };
