// Recipes typed from scratch via the "Enter Manually" tab (client/src/
// components/RecipeReplaceModal.jsx's ManualEntryTab), promoted into the
// shared cross-patient recipe library instead of staying a one-off entry in
// diet_recipe_overrides (that table still ALSO gets its own row, unchanged,
// so the recipe applies to the patient the coach was actually working on
// right away). Tagged with the same mealType/condition/dietType vocabulary
// server/diet-data/recipe-library.json uses (see recipeEligibility.js), so
// index.js's /api/recipe-alternatives and /api/recipe/:recipeId can merge
// these rows straight into that static array with no shape translation.
//
// That static file is read-only at runtime (see index.js's loadRecipeLibrary
// comment) and wouldn't survive a redeploy/serverless cold start if written
// to directly — this table is the live, writable counterpart.
const { supabaseAdmin } = require('./supabaseAdmin');

async function listManualRecipes() {
  const { data, error } = await supabaseAdmin
    .from('diet_manual_recipes')
    .select('recipe_id, name, ingredients, steps, image, meal_types, conditions, diet_types, language, allergens, created_by_name');
  if (error) throw error;
  return (data || []).map((r) => ({
    recipe_id: r.recipe_id,
    name: r.name,
    ingredients: r.ingredients || [],
    steps: r.steps || [],
    image: r.image || undefined,
    mealTypes: r.meal_types || [],
    conditions: r.conditions || [],
    dietTypes: r.diet_types || [],
    language: r.language || undefined,
    allergens: r.allergens || [],
    // A human typed this just now — same "no unreviewed-draft caution
    // needed" convention ManualEntryTab's own client-side object already
    // uses for the per-patient override it saves alongside this.
    reviewed: true,
    manuallyAdded: true,
    addedByName: r.created_by_name || undefined,
  }));
}

async function saveManualRecipe(recipe, { mealType, conditions, dietType, language, allergens, createdByName }) {
  const row = {
    recipe_id: recipe.recipe_id,
    name: recipe.name,
    ingredients: recipe.ingredients || [],
    steps: recipe.steps || [],
    image: recipe.image || null,
    meal_types: mealType ? [mealType] : [],
    conditions: conditions || [],
    diet_types: dietType ? [dietType] : [],
    language: language || null,
    allergens: allergens || [],
    created_by_name: createdByName || null,
  };
  const { data, error } = await supabaseAdmin
    .from('diet_manual_recipes')
    .upsert(row)
    .select('recipe_id')
    .single();
  if (error) throw error;
  return data.recipe_id;
}

module.exports = { listManualRecipes, saveManualRecipe };
