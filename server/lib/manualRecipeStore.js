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

// Powers the standalone recipe Library page (GET /api/recipe-library-full) —
// same table as listManualRecipes above, but also selects gear/categories/
// created_at, which that function deliberately leaves out (see its own
// comment): those columns only exist once supabase/schema.sql's `alter
// table ... add column if not exists gear/categories` has been re-run, and
// listManualRecipes still backs the always-on [Replace]/[Add] pickers, which
// must keep working even on a database that hasn't been migrated yet.
async function listManualRecipesFull() {
  const { data, error } = await supabaseAdmin
    .from('diet_manual_recipes')
    .select('recipe_id, name, ingredients, steps, image, meal_types, conditions, diet_types, language, allergens, created_by_name, created_at, gear, categories');
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
    gear: r.gear || [],
    categories: r.categories || [],
    addedAt: r.created_at || null,
    reviewed: true,
    manuallyAdded: true,
    addedByName: r.created_by_name || undefined,
  }));
}

// The Library's own [+ Add recipe] (POST /api/recipe-library) — a fresh row,
// tagged directly with the Library's own vocabulary (condition(s), gear(s),
// categories, language) rather than derived from a patient's plan the way
// saveManualRecipe's mealType/dietType/conditions are. Always an insert, not
// an upsert: recipe_id is freshly generated per submission (server/index.js),
// never reused.
async function addLibraryRecipe({ recipe, conditions, dietTypes, language, gear, categories, createdByName }) {
  const row = {
    recipe_id: recipe.recipe_id,
    name: recipe.name,
    ingredients: recipe.ingredients || [],
    steps: recipe.steps || [],
    image: recipe.image || null,
    meal_types: [],
    conditions: conditions || [],
    diet_types: dietTypes || [],
    language: language || null,
    allergens: recipe.allergens || [],
    created_by_name: createdByName || null,
    gear: gear || [],
    categories: categories || [],
  };
  const { data, error } = await supabaseAdmin
    .from('diet_manual_recipes')
    .insert(row)
    .select('recipe_id, name, ingredients, steps, image, meal_types, conditions, diet_types, language, allergens, created_by_name, created_at, gear, categories')
    .single();
  if (error) throw error;
  return {
    recipe_id: data.recipe_id,
    name: data.name,
    ingredients: data.ingredients || [],
    steps: data.steps || [],
    image: data.image || undefined,
    mealTypes: data.meal_types || [],
    conditions: data.conditions || [],
    dietTypes: data.diet_types || [],
    language: data.language || undefined,
    allergens: data.allergens || [],
    gear: data.gear || [],
    categories: data.categories || [],
    addedAt: data.created_at || null,
    reviewed: true,
    manuallyAdded: true,
    addedByName: data.created_by_name || undefined,
  };
}

module.exports = { listManualRecipes, saveManualRecipe, listManualRecipesFull, addLibraryRecipe };
