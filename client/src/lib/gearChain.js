// A gear's diet document holds exactly one meal: Gear 2 is Breakfast, Gear 3
// is Lunch, Gear 4 is Dinner. So the plan for a gear is that gear's document
// plus every later one — Gear 2 => Breakfast + Lunch + Dinner, Gear 3 =>
// Lunch + Dinner, Gear 4 => Dinner alone. DietViewerPanel has always chained
// the .docx files this way (see its printChain); this states the same rule
// once so the data-driven viewer can't drift from it.
import { matchDietOptions } from './matchDiet';

export const GEAR_MEAL_LABELS = { 2: 'Breakfast', 3: 'Lunch', 4: 'Dinner' };
export const LAST_GEAR = 4;

export function mealLabelForGear(gear) {
  return GEAR_MEAL_LABELS[gear] || `Gear ${gear}`;
}

// Resolves the gear's own manifest entry plus every later gear's, using the
// same matchDietOptions call GearViewer already makes for a single gear —
// just repeated across the chain. A gear with no match for this person is
// skipped rather than treated as a failure: not every condition has all
// three gears, and a missing later gear shouldn't hide the ones that exist.
export function resolveGearChain(manifestFiles, person, gear) {
  const out = [];
  for (let g = gear; g <= LAST_GEAR; g++) {
    const entry = matchDietOptions(manifestFiles, person, g)[0]?.best || null;
    if (entry) out.push({ gear: g, entry, mealLabel: mealLabelForGear(g) });
  }
  return out;
}
