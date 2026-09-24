export const CONDITION_LABELS = {
  DIABETES: 'Diabetes',
  THYROID: 'Thyroid',
  KIDNEY: 'Kidney',
  BP: 'Blood Pressure',
  CHOLESTEROL: 'Cholesterol',
};

export const DIET_LABELS = {
  VEG: 'Vegetarian',
  NONVEG: 'Non-Vegetarian',
  EGG: 'Eggetarian',
};

export const LANGUAGE_LABELS = {
  TAM: 'Tamil',
  ENG: 'English',
};

// The recipe Library's own tagging vocabulary (sidebar "Library" section) —
// must stay in sync with LIBRARY_CATEGORIES/LIBRARY_GEARS in server/index.js,
// which rejects anything outside these on POST /api/recipe-library.
export const LIBRARY_CATEGORY_OPTIONS = [
  'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Kashayam', 'Fruits', 'Nuts', 'Herbal Tea', 'Juice', 'Salad', 'Soup',
];
export const LIBRARY_GEAR_OPTIONS = [2, 3, 4];
