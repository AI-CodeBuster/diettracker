// Starter food-matching + substitution knowledge base.
//
// NOT a clinical/exhaustive nutrition database — seeded from the dislike /
// allergy values already seen in the real roster data (goat meat, sea food,
// bottle gourd, honey, butter/ghee, ...) plus common allergens, so the
// "automatic" detection has something concrete to match against. Meant to be
// extended over time by adding entries here; each entry is independent.
//
// Each rule groups a *substitute category* (e.g. DAIRY) that can offer a
// shared set of alternatives, but the category can bundle several genuinely
// different foods (milk, curd, ghee, butter, paneer, cheese are all
// "DAIRY"). `terms` is therefore an array of narrower sub-groups, each one
// **exactly one specific food concept** with its own `keywords` (English,
// matched case-insensitively as loose substrings against a patient's typed
// dislike/allergy text) and `tamilKeywords` (the Tamil equivalent(s), used
// the same way against Tamil-typed text and Tamil-language diet charts —
// also a starter set, not a verified medical translation).
//
// Translating a matched term (see translateTerm below) only ever returns
// the specific sub-group's tamilKeywords — e.g. a "curd" allergy translates
// to "தயிர்" only, never pulling in "நெய்" (ghee) or "பால்" (milk) just
// because they're in the same DAIRY substitute category. Conflating those
// would flag foods the patient never reported as an allergy/dislike.
//
// `substitutes` / `substitutesTamil` give at least 5 diet-appropriate
// alternatives per diet type, applied at the whole-category level (any
// DAIRY dislike gets a dairy-free swap) since substitute suitability
// doesn't need to be as precise as match detection — this keeps repeated
// presses of "Auto (try another)" landing on a genuinely different
// suggestion instead of quickly cycling back to the first one. VEG is the
// fallback list when a diet-type-specific list isn't defined.

const foodRules = [
  {
    category: 'EGG',
    terms: [
      { keywords: ['egg', 'eggs', 'omelet', 'omelette', 'boiled egg'], tamilKeywords: ['முட்டை'] },
    ],
    substitutes: {
      VEG: ['Paneer Bhurji', 'Boiled Moong Sprouts', 'Tofu Bhurji', 'Sprouted Moong Chilla', 'Boiled Chickpeas Salad'],
      NONVEG: ['Grilled Chicken (small portion)', 'Paneer Bhurji', 'Grilled Fish (small portion)', 'Chicken Keema (lean, small portion)', 'Boiled Chicken Strips'],
      EGG: ['Egg White Only', 'Egg White Bhurji', 'Steamed Egg White Omelette', 'Boiled Egg Whites (2)', 'Egg White Curry'],
    },
    substitutesTamil: {
      VEG: ['பன்னீர் பொரியல்', 'முளைகட்டிய பாசிப்பயறு (வேகவைத்தது)', 'தோஃபு பொரியல்', 'முளைகட்டிய பாசிப்பயறு சில்லா', 'வேகவைத்த கொண்டைக்கடலை சாலட்'],
      NONVEG: ['கிரில் செய்த கோழி (சிறிய அளவு)', 'பன்னீர் பொரியல்', 'கிரில் செய்த மீன் (சிறிய அளவு)', 'கோழி கீமா (லீன், சிறிய அளவு)', 'வேகவைத்த கோழி துண்டுகள்'],
      EGG: ['முட்டை வெள்ளைக்கரு மட்டும்', 'முட்டை வெள்ளைக்கரு பொரியல்', 'ஆவியில் வேகவைத்த முட்டை வெள்ளைக்கரு ஆம்லேட்', 'வேகவைத்த முட்டை வெள்ளைக்கரு (2)', 'முட்டை வெள்ளைக்கரு கறி'],
    },
  },
  {
    category: 'DAIRY',
    terms: [
      { keywords: ['milk'], tamilKeywords: ['பால்'] },
      { keywords: ['curd', 'yogurt'], tamilKeywords: ['தயிர்'] },
      { keywords: ['ghee'], tamilKeywords: ['நெய்'] },
      { keywords: ['butter'], tamilKeywords: ['வெண்ணெய்'] },
      { keywords: ['paneer'], tamilKeywords: ['பன்னீர்'] },
      { keywords: ['cheese'], tamilKeywords: ['சீஸ்'] },
    ],
    substitutes: {
      VEG: ['Coconut Milk', 'Almond Milk', 'Cold-pressed Oil (in place of ghee/butter)', 'Oats Milk', 'Soy Milk'],
    },
    substitutesTamil: {
      VEG: ['தேங்காய்ப் பால்', 'பாதாம் பால்', 'நெய்/வெண்ணெய்க்கு பதிலாக கோல்ட்-பிரஸ் எண்ணெய்', 'ஓட்ஸ் பால்', 'சோயா பால்'],
    },
  },
  {
    category: 'PEANUT_NUTS',
    terms: [
      { keywords: ['peanut', 'peanuts', 'groundnut', 'groundnuts'], tamilKeywords: ['வேர்க்கடலை'] },
      { keywords: ['cashew'], tamilKeywords: ['முந்திரி'] },
      { keywords: ['almond'], tamilKeywords: ['பாதாம்'] },
      { keywords: ['walnut'], tamilKeywords: ['அக்ரூட் பருப்பு'] },
      { keywords: ['nuts'], tamilKeywords: ['கொட்டைகள்'] },
    ],
    substitutes: {
      VEG: ['Roasted Sunflower Seeds', 'Roasted Chana', 'Roasted Pumpkin Seeds', 'Roasted Flax Seeds', 'Puffed Rice (Pori)'],
    },
    substitutesTamil: {
      VEG: ['வறுத்த சூரியகாந்தி விதைகள்', 'வறுத்த கடலை', 'வறுத்த பூசணி விதைகள்', 'வறுத்த ஆளி விதைகள்', 'பொரி'],
    },
  },
  {
    category: 'SEAFOOD',
    terms: [
      { keywords: ['fish', 'sea food', 'seafood'], tamilKeywords: ['மீன்'] },
      { keywords: ['prawns', 'prawn', 'shrimp'], tamilKeywords: ['இறால்'] },
      { keywords: ['crab', 'crabs'], tamilKeywords: ['நண்டு'] },
    ],
    substitutes: {
      NONVEG: ['Grilled Chicken', 'Boiled Egg Whites', 'Chicken Curry (lean cut)', 'Grilled Chicken Breast', 'Chicken Keema (lean, small portion)'],
      EGG: ['Boiled Egg Whites', 'Boiled Egg (1, whole)', 'Egg White Bhurji', 'Egg Curry', 'Egg Drop Soup'],
      VEG: ['Grilled Paneer', 'Soya Chunks Curry', 'Mushroom Curry', 'Tofu Curry', 'Moong Dal Chilla'],
    },
    substitutesTamil: {
      NONVEG: ['கிரில் செய்த கோழி', 'வேகவைத்த முட்டை வெள்ளைக்கரு', 'கோழி கறி (லீன் கட்)', 'கிரில் செய்த கோழி மார்பகம்', 'கோழி கீமா (லீன், சிறிய அளவு)'],
      EGG: ['வேகவைத்த முட்டை வெள்ளைக்கரு', 'வேகவைத்த முட்டை (1, முழுவதும்)', 'முட்டை வெள்ளைக்கரு பொரியல்', 'முட்டை கறி', 'முட்டை சூப்'],
      VEG: ['கிரில் செய்த பன்னீர்', 'சோயா சங்க்ஸ் கறி', 'காளான் கறி', 'தோஃபு கறி', 'பாசிப்பயறு சில்லா'],
    },
  },
  {
    category: 'RED_MEAT',
    terms: [
      { keywords: ['mutton', 'goat meat', 'red meat'], tamilKeywords: ['ஆட்டு இறைச்சி'] },
      { keywords: ['beef'], tamilKeywords: ['மாட்டு இறைச்சி'] },
      { keywords: ['pork'], tamilKeywords: ['பன்றி இறைச்சி'] },
      { keywords: ['chicken'], tamilKeywords: ['கோழி'] },
    ],
    substitutes: {
      NONVEG: ['Skinless Chicken (lean cut)', 'Fish Curry', 'Grilled Chicken Breast', 'Chicken Keema (lean, small portion)', 'Boiled Chicken Strips'],
      EGG: ['Egg Curry', 'Boiled Egg (1, whole)', 'Egg White Bhurji', 'Egg Drop Soup', 'Steamed Egg White Omelette'],
      VEG: ['Soya Chunks Curry', 'Mushroom Curry', 'Paneer Curry', 'Moong Dal Chilla', 'Tofu Curry'],
    },
    substitutesTamil: {
      NONVEG: ['தோலுரிக்கப்பட்ட கோழி (லீன் கட்)', 'மீன் கறி', 'கிரில் செய்த கோழி மார்பகம்', 'கோழி கீமா (லீன், சிறிய அளவு)', 'வேகவைத்த கோழி துண்டுகள்'],
      EGG: ['முட்டை கறி', 'வேகவைத்த முட்டை (1, முழுவதும்)', 'முட்டை வெள்ளைக்கரு பொரியல்', 'முட்டை சூப்', 'ஆவியில் வேகவைத்த முட்டை வெள்ளைக்கரு ஆம்லேட்'],
      VEG: ['சோயா சங்க்ஸ் கறி', 'காளான் கறி', 'பன்னீர் கறி', 'பாசிப்பயறு சில்லா', 'தோஃபு கறி'],
    },
  },
  {
    category: 'BOTTLE_GOURD',
    terms: [
      { keywords: ['bottle gourd', 'churaikkai'], tamilKeywords: ['சுரைக்காய்'] },
    ],
    substitutes: {
      VEG: ['Ridge Gourd Poriyal', 'Snake Gourd Poriyal', 'Ash Gourd Poriyal', 'Cluster Beans Poriyal', 'Beans Poriyal'],
    },
    substitutesTamil: {
      VEG: ['பீர்க்கங்காய் பொரியல்', 'புடலங்காய் பொரியல்', 'பூசணிக்காய் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'அவரைக்காய் பொரியல்'],
    },
  },
  {
    category: 'BITTER_GOURD',
    terms: [
      { keywords: ['bitter gourd', 'bittergourd', 'karela'], tamilKeywords: ['பாகற்காய்'] },
    ],
    substitutes: {
      VEG: ['Cluster Beans Poriyal', 'Ladies Finger Poriyal', 'Beans Poriyal', 'Carrot Poriyal', 'Ridge Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['கொத்தவரங்காய் பொரியல்', 'வெண்டைக்காய் பொரியல்', 'அவரைக்காய் பொரியல்', 'கேரட் பொரியல்', 'பீர்க்கங்காய் பொரியல்'],
    },
  },
  {
    category: 'BRINJAL',
    terms: [
      { keywords: ['brinjal', 'eggplant', 'aubergine'], tamilKeywords: ['கத்தரிக்காய்'] },
    ],
    substitutes: {
      VEG: ['Beans Poriyal', 'Cabbage Poriyal', 'Carrot Poriyal', 'Ridge Gourd Poriyal', 'Ladies Finger Poriyal'],
    },
    substitutesTamil: {
      VEG: ['அவரைக்காய் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'கேரட் பொரியல்', 'பீர்க்கங்காய் பொரியல்', 'வெண்டைக்காய் பொரியல்'],
    },
  },
  {
    category: 'LADIES_FINGER',
    terms: [
      { keywords: ['ladies finger', "lady's finger", 'okra'], tamilKeywords: ['வெண்டைக்காய்'] },
    ],
    substitutes: {
      VEG: ['Beans Poriyal', 'Carrot Poriyal', 'Cabbage Poriyal', 'Ridge Gourd Poriyal', 'Cluster Beans Poriyal'],
    },
    substitutesTamil: {
      VEG: ['அவரைக்காய் பொரியல்', 'கேரட் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'பீர்க்கங்காய் பொரியல்', 'கொத்தவரங்காய் பொரியல்'],
    },
  },
  {
    category: 'DRUMSTICK',
    terms: [
      { keywords: ['drumstick', 'moringa'], tamilKeywords: ['முருங்கைக்காய்'] },
    ],
    substitutes: {
      VEG: ['Beans Poriyal', 'Cluster Beans Poriyal', 'Ridge Gourd Poriyal', 'Carrot Poriyal', 'Snake Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['அவரைக்காய் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'பீர்க்கங்காய் பொரியல்', 'கேரட் பொரியல்', 'புடலங்காய் பொரியல்'],
    },
  },
  {
    category: 'GREEN_BANANA',
    terms: [
      { keywords: ['green banana', 'raw banana', 'plantain'], tamilKeywords: ['வாழைக்காய்'] },
    ],
    substitutes: {
      VEG: ['Raw Papaya Poriyal', 'Chow Chow Poriyal', 'Ridge Gourd Poriyal', 'Beans Poriyal', 'Carrot Poriyal'],
    },
    substitutesTamil: {
      VEG: ['பப்பாளி பொரியல்', 'சவ் சவ் பொரியல்', 'பீர்க்கங்காய் பொரியல்', 'அவரைக்காய் பொரியல்', 'கேரட் பொரியல்'],
    },
  },
  {
    category: 'HONEY_SWEETENER',
    terms: [
      { keywords: ['honey'], tamilKeywords: ['தேன்'] },
      { keywords: ['jaggery'], tamilKeywords: ['வெல்லம்'] },
      { keywords: ['sugar'], tamilKeywords: ['சர்க்கரை'] },
    ],
    substitutes: {
      VEG: ['Stevia (in moderation, if condition allows)', 'Skip added sweetener', 'Dates Paste (in moderation)', 'Cinnamon (as natural sweetness)', 'Fresh Fruit (in place of added sugar)'],
    },
    substitutesTamil: {
      VEG: ['ஸ்டீவியா (நிலைமை அனுமதித்தால், மிதமாக)', 'சேர்க்கப்படும் இனிப்பைத் தவிர்க்கவும்', 'பேரீச்சம் பழ விழுது (மிதமாக)', 'இலவங்கப்பட்டை (இயற்கை இனிப்புக்கு)', 'பழுத்த பழம் (சேர்க்கப்படும் சர்க்கரைக்கு பதிலாக)'],
    },
  },
  {
    category: 'SOY',
    terms: [
      { keywords: ['soy', 'soya', 'soybean'], tamilKeywords: ['சோயா'] },
      { keywords: ['tofu'], tamilKeywords: ['தோஃபு'] },
    ],
    substitutes: {
      VEG: ['Moong Dal Chilla', 'Paneer', 'Chana Chilla', 'Boiled Chickpeas Salad', 'Sprouted Moong Salad'],
    },
    substitutesTamil: {
      VEG: ['பாசிப்பயறு சில்லா', 'பன்னீர்', 'கொண்டைக்கடலை சில்லா', 'வேகவைத்த கொண்டைக்கடலை சாலட்', 'முளைகட்டிய பாசிப்பயறு சாலட்'],
    },
  },
  {
    category: 'SESAME',
    terms: [
      { keywords: ['sesame', 'til', 'gingelly'], tamilKeywords: ['எள்'] },
    ],
    substitutes: {
      VEG: ['Sunflower Seeds', 'Coconut (grated, in moderation)', 'Roasted Chana', 'Flax Seeds (roasted)', 'Roasted Pumpkin Seeds'],
    },
    substitutesTamil: {
      VEG: ['சூரியகாந்தி விதைகள்', 'தேங்காய் (துருவியது, மிதமாக)', 'வறுத்த கடலை', 'ஆளி விதைகள் (வறுத்தது)', 'வறுத்த பூசணி விதைகள்'],
    },
  },
  {
    category: 'MUSHROOM',
    terms: [
      { keywords: ['mushroom'], tamilKeywords: ['காளான்'] },
    ],
    substitutes: {
      VEG: ['Paneer Curry', 'Soya Chunks Curry', 'Tofu Curry', 'Moong Dal Chilla', 'Cluster Beans Poriyal'],
    },
    substitutesTamil: {
      VEG: ['பன்னீர் கறி', 'சோயா சங்க்ஸ் கறி', 'தோஃபு கறி', 'பாசிப்பயறு சில்லா', 'கொத்தவரங்காய் பொரியல்'],
    },
  },
  // The categories below were added after auditing real dislike/allergy
  // text across every sheet in the live roster — these are the specific
  // foods that showed up repeatedly (potato x9, garlic x6, onion/ginger x4,
  // upma x5, ...) but had no rule at all, so a Tamil-language chart could
  // never flag them even though the English term was on file.
  {
    category: 'POTATO',
    terms: [{ keywords: ['potato', 'potatoes'], tamilKeywords: ['உருளைக்கிழங்கு'] }],
    substitutes: {
      VEG: ['Sweet Potato (limited portion)', 'Raw Banana Poriyal', 'Yam Poriyal (limited portion)', 'Beans Poriyal', 'Carrot Poriyal'],
    },
    substitutesTamil: {
      VEG: ['சர்க்கரைவள்ளிக்கிழங்கு (குறைந்த அளவு)', 'வாழைக்காய் பொரியல்', 'சேனைக்கிழங்கு பொரியல் (குறைந்த அளவு)', 'அவரைக்காய் பொரியல்', 'கேரட் பொரியல்'],
    },
  },
  {
    category: 'GARLIC',
    terms: [{ keywords: ['garlic'], tamilKeywords: ['பூண்டு'] }],
    substitutes: {
      VEG: ['Prepare without garlic, use other spices', 'Asafoetida (Hing, small pinch)', 'Cumin Seeds (Jeera)', 'Curry Leaves', 'Coriander Leaves (Garnish)'],
    },
    substitutesTamil: {
      VEG: ['பூண்டு இல்லாமல் தயாரிக்கவும், மற்ற மசாலாப் பொருட்களைப் பயன்படுத்தவும்', 'பெருங்காயம் (சிட்டிகை அளவு)', 'சீரகம்', 'கறிவேப்பிலை', 'கொத்தமல்லி இலை (அலங்காரத்திற்கு)'],
    },
  },
  {
    category: 'ONION',
    terms: [{ keywords: ['onion', 'onions', 'raw onion'], tamilKeywords: ['வெங்காயம்'] }],
    substitutes: {
      VEG: ['Prepare without onion, use other spices', 'Asafoetida (Hing, small pinch)', 'Curry Leaves', 'Fennel Seeds (Sombu)', 'Coriander Leaves (Garnish)'],
    },
    substitutesTamil: {
      VEG: ['வெங்காயம் இல்லாமல் தயாரிக்கவும், மற்ற மசாலாப் பொருட்களைப் பயன்படுத்தவும்', 'பெருங்காயம் (சிட்டிகை அளவு)', 'கறிவேப்பிலை', 'சோம்பு', 'கொத்தமல்லி இலை (அலங்காரத்திற்கு)'],
    },
  },
  {
    category: 'GINGER',
    terms: [{ keywords: ['ginger'], tamilKeywords: ['இஞ்சி'] }],
    substitutes: {
      VEG: ['Prepare without ginger', 'Black Pepper (Milagu)', 'Cumin Seeds (Jeera)', 'Curry Leaves', 'Coriander Leaves (Garnish)'],
    },
    substitutesTamil: {
      VEG: ['இஞ்சி இல்லாமல் தயாரிக்கவும்', 'மிளகு', 'சீரகம்', 'கறிவேப்பிலை', 'கொத்தமல்லி இலை (அலங்காரத்திற்கு)'],
    },
  },
  {
    category: 'CABBAGE',
    terms: [{ keywords: ['cabbage'], tamilKeywords: ['முட்டைகோஸ்'] }],
    substitutes: {
      VEG: ['Beans Poriyal', 'Carrot Poriyal', 'Cauliflower Poriyal', 'Cluster Beans Poriyal', 'Ridge Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['அவரைக்காய் பொரியல்', 'கேரட் பொரியல்', 'காலிஃபிளவர் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'பீர்க்கங்காய் பொரியல்'],
    },
  },
  {
    category: 'CAULIFLOWER',
    terms: [{ keywords: ['cauliflower'], tamilKeywords: ['காலிஃபிளவர்', 'பூக்கோஸ்'] }],
    substitutes: {
      VEG: ['Cabbage Poriyal', 'Beans Poriyal', 'Carrot Poriyal', 'Cluster Beans Poriyal', 'Ridge Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['முட்டைகோஸ் பொரியல்', 'அவரைக்காய் பொரியல்', 'கேரட் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'பீர்க்கங்காய் பொரியல்'],
    },
  },
  {
    category: 'CUCUMBER',
    terms: [{ keywords: ['cucumber'], tamilKeywords: ['வெள்ளரிக்காய்'] }],
    substitutes: {
      VEG: ['Carrot Salad', 'Ridge Gourd Poriyal', 'Beetroot Salad', 'Tomato Salad', 'Cabbage Salad'],
    },
    substitutesTamil: {
      VEG: ['கேரட் சாலட்', 'பீர்க்கங்காய் பொரியல்', 'பீட்ரூட் சாலட்', 'தக்காளி சாலட்', 'முட்டைகோஸ் சாலட்'],
    },
  },
  {
    category: 'CARROT',
    terms: [{ keywords: ['carrot', 'carrots'], tamilKeywords: ['கேரட்'] }],
    substitutes: {
      VEG: ['Beetroot Poriyal', 'Beans Poriyal', 'Cabbage Poriyal', 'Cluster Beans Poriyal', 'Ridge Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['பீட்ரூட் பொரியல்', 'அவரைக்காய் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'பீர்க்கங்காய் பொரியல்'],
    },
  },
  {
    category: 'BEETROOT',
    terms: [{ keywords: ['beetroot', 'beet'], tamilKeywords: ['பீட்ரூட்'] }],
    substitutes: {
      VEG: ['Carrot Poriyal', 'Cluster Beans Poriyal', 'Beans Poriyal', 'Cabbage Poriyal', 'Radish Poriyal'],
    },
    substitutesTamil: {
      VEG: ['கேரட் பொரியல்', 'கொத்தவரங்காய் பொரியல்', 'அவரைக்காய் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'முள்ளங்கி பொரியல்'],
    },
  },
  {
    category: 'RADISH',
    terms: [{ keywords: ['radish', 'raddish'], tamilKeywords: ['முள்ளங்கி'] }],
    substitutes: {
      VEG: ['Carrot Poriyal', 'Beans Poriyal', 'Beetroot Poriyal', 'Cabbage Poriyal', 'Cluster Beans Poriyal'],
    },
    substitutesTamil: {
      VEG: ['கேரட் பொரியல்', 'அவரைக்காய் பொரியல்', 'பீட்ரூட் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'கொத்தவரங்காய் பொரியல்'],
    },
  },
  {
    category: 'MANGO',
    terms: [{ keywords: ['mango'], tamilKeywords: ['மாம்பழம்'] }],
    substitutes: {
      VEG: ['Guava (in moderation)', 'Papaya', 'Apple', 'Pear', 'Watermelon (limited portion)'],
    },
    substitutesTamil: {
      VEG: ['கொய்யா (மிதமாக)', 'பப்பாளி', 'ஆப்பிள்', 'பேரிக்காய்', 'தர்பூசணி (குறைந்த அளவு)'],
    },
  },
  {
    category: 'LEMON_CITRUS',
    terms: [{ keywords: ['lemon', 'citrus'], tamilKeywords: ['எலுமிச்சை'] }],
    substitutes: {
      VEG: ['Skip / use a non-citrus souring agent (tamarind, in moderation)', 'Tamarind (in moderation)', 'Raw Mango (in moderation)', 'Kokum (in moderation)', 'Vinegar (small amount)'],
    },
    substitutesTamil: {
      VEG: ['தவிர்க்கவும் / புளி (மிதமாக) பயன்படுத்தவும்', 'புளி (மிதமாக)', 'மாங்காய் (மிதமாக)', 'கோகம் (மிதமாக)', 'வினிகர் (சிறிதளவு)'],
    },
  },
  {
    category: 'WHEAT',
    terms: [{ keywords: ['wheat'], tamilKeywords: ['கோதுமை'] }],
    substitutes: {
      VEG: ['Millet-based alternative (Ragi/Jowar)', 'Ragi Dosa', 'Jowar Roti', 'Oats Porridge', 'Rice-based Idli'],
    },
    substitutesTamil: {
      VEG: ['சிறுதானிய மாற்று (ராகி/சோளம்)', 'ராகி தோசை', 'சோள ரொட்டி', 'ஓட்ஸ் கஞ்சி', 'அரிசி இட்லி'],
    },
  },
  {
    category: 'YAM',
    terms: [{ keywords: ['yam'], tamilKeywords: ['சேனைக்கிழங்கு'] }],
    substitutes: {
      VEG: ['Raw Banana Poriyal', 'Beans Poriyal', 'Sweet Potato (limited portion)', 'Carrot Poriyal', 'Ridge Gourd Poriyal'],
    },
    substitutesTamil: {
      VEG: ['வாழைக்காய் பொரியல்', 'அவரைக்காய் பொரியல்', 'சர்க்கரைவள்ளிக்கிழங்கு (குறைந்த அளவு)', 'கேரட் பொரியல்', 'பீர்க்கங்காய் பொரியல்'],
    },
  },
  {
    category: 'CAPSICUM',
    terms: [{ keywords: ['capsicum', 'bell pepper'], tamilKeywords: ['குடமிளகாய்'] }],
    substitutes: {
      VEG: ['Beans Poriyal', 'Carrot Poriyal', 'Cabbage Poriyal', 'Ridge Gourd Poriyal', 'Cluster Beans Poriyal'],
    },
    substitutesTamil: {
      VEG: ['அவரைக்காய் பொரியல்', 'கேரட் பொரியல்', 'முட்டைகோஸ் பொரியல்', 'பீர்க்கங்காய் பொரியல்', 'கொத்தவரங்காய் பொரியல்'],
    },
  },
  {
    category: 'CLOVE',
    terms: [{ keywords: ['clove', 'cloves'], tamilKeywords: ['கிராம்பு'] }],
    substitutes: {
      VEG: ['Prepare without clove', 'Cinnamon (small amount, if tolerated)', 'Black Pepper (Milagu)', 'Cumin Seeds (Jeera)', 'Curry Leaves'],
    },
    substitutesTamil: {
      VEG: ['கிராம்பு இல்லாமல் தயாரிக்கவும்', 'பட்டை (சிறிதளவு, தாங்கக்கூடுமெனில்)', 'மிளகு', 'சீரகம்', 'கறிவேப்பிலை'],
    },
  },
  {
    category: 'CINNAMON',
    terms: [{ keywords: ['cinnamon'], tamilKeywords: ['பட்டை', 'இலவங்கப்பட்டை'] }],
    substitutes: {
      VEG: ['Prepare without cinnamon', 'Cardamom (small amount, if tolerated)', 'Black Pepper (Milagu)', 'Cumin Seeds (Jeera)', 'Curry Leaves'],
    },
    substitutesTamil: {
      VEG: ['பட்டை இல்லாமல் தயாரிக்கவும்', 'ஏலக்காய் (சிறிதளவு, தாங்கக்கூடுமெனில்)', 'மிளகு', 'சீரகம்', 'கறிவேப்பிலை'],
    },
  },
  {
    category: 'NOODLES',
    terms: [{ keywords: ['noodles'], tamilKeywords: ['நூடுல்ஸ்'] }],
    substitutes: {
      VEG: ['Vegetable Poha', 'Idiyappam', 'Millet Upma', 'Ragi Dosa', 'Rice Idli'],
    },
    substitutesTamil: {
      VEG: ['காய்கறி அவல் (போகா)', 'இடியாப்பம்', 'சிறுதானிய உப்புமா', 'ராகி தோசை', 'அரிசி இட்லி'],
    },
  },
  {
    category: 'PIZZA',
    terms: [{ keywords: ['pizza'], tamilKeywords: ['பீட்சா'] }],
    substitutes: {
      VEG: ['Multigrain Vegetable Sandwich', 'Vegetable Uthappam', 'Ragi Dosa with Vegetables', 'Multigrain Vegetable Wrap', 'Vegetable Idli'],
    },
    substitutesTamil: {
      VEG: ['பல தானிய காய்கறி சாண்ட்விச்', 'காய்கறி உத்தப்பம்', 'காய்கறியுடன் ராகி தோசை', 'பல தானிய காய்கறி ரோல்', 'காய்கறி இட்லி'],
    },
  },
  {
    category: 'BIRIYANI',
    terms: [{ keywords: ['biriyani', 'briyani', 'biryani'], tamilKeywords: ['பிரியாணி'] }],
    substitutes: {
      VEG: ['Vegetable Pulao (less oil)', 'Vegetable Khichdi', 'Curd Rice (limited portion)', 'Lemon Rice (less oil)', 'Vegetable Fried Rice (less oil)'],
      NONVEG: ['Chicken Pulao (less oil, lean cut)', 'Chicken Khichdi (lean cut)', 'Grilled Chicken with Rice', 'Chicken Soup with Rice', 'Boiled Chicken with Curd Rice'],
    },
    substitutesTamil: {
      VEG: ['காய்கறி புலாவ் (குறைந்த எண்ணெய்)', 'காய்கறி கிச்சடி', 'தயிர் சாதம் (குறைந்த அளவு)', 'எலுமிச்சை சாதம் (குறைந்த எண்ணெய்)', 'காய்கறி பொரித்த சாதம் (குறைந்த எண்ணெய்)'],
      NONVEG: ['கோழி புலாவ் (குறைந்த எண்ணெய், லீன் கட்)', 'கோழி கிச்சடி (லீன் கட்)', 'சாதத்துடன் கிரில் செய்த கோழி', 'சாதத்துடன் கோழி சூப்', 'தயிர் சாதத்துடன் வேகவைத்த கோழி'],
    },
  },
  {
    category: 'UPMA_RAVA',
    terms: [
      { keywords: ['upma'], tamilKeywords: ['உப்புமா'] },
      { keywords: ['rava', 'sooji', 'semolina'], tamilKeywords: ['ரவை'] },
    ],
    substitutes: {
      VEG: ['Idli', 'Oats Porridge', 'Ragi Dosa', 'Rice-based Pongal (less ghee)', 'Vegetable Poha'],
    },
    substitutesTamil: {
      VEG: ['இட்லி', 'ஓட்ஸ் கஞ்சி', 'ராகி தோசை', 'அரிசி பொங்கல் (குறைந்த நெய்)', 'காய்கறி அவல் (போகா)'],
    },
  },
  {
    category: 'MILLETS',
    terms: [{ keywords: ['millets', 'millet'], tamilKeywords: ['சிறுதானியங்கள்'] }],
    substitutes: {
      VEG: ['Red Rice (in moderation)', 'White Rice (in moderation)', 'Idli (in moderation)', 'Dosa (in moderation)', 'Wheat Roti (in moderation, if tolerated)'],
    },
    substitutesTamil: {
      VEG: ['சிவப்பு அரிசி (மிதமாக)', 'வெள்ளை அரிசி (மிதமாக)', 'இட்லி (மிதமாக)', 'தோசை (மிதமாக)', 'கோதுமை ரொட்டி (மிதமாக, தாங்கக்கூடுமெனில்)'],
    },
  },
  {
    category: 'ORGAN_MEAT',
    terms: [{ keywords: ['organ meat', 'offal'], tamilKeywords: ['உள்ளுறுப்பு இறைச்சி'] }],
    substitutes: {
      NONVEG: ['Skinless Chicken (lean cut)', 'Grilled Chicken Breast', 'Fish Curry', 'Chicken Keema (lean, small portion)', 'Boiled Chicken Strips'],
      VEG: ['Soya Chunks Curry', 'Paneer Curry', 'Mushroom Curry', 'Moong Dal Chilla', 'Tofu Curry'],
    },
    substitutesTamil: {
      NONVEG: ['தோலுரிக்கப்பட்ட கோழி (லீன் கட்)', 'கிரில் செய்த கோழி மார்பகம்', 'மீன் கறி', 'கோழி கீமா (லீன், சிறிய அளவு)', 'வேகவைத்த கோழி துண்டுகள்'],
      VEG: ['சோயா சங்க்ஸ் கறி', 'பன்னீர் கறி', 'காளான் கறி', 'பாசிப்பயறு சில்லா', 'தோஃபு கறி'],
    },
  },
];

// Flattened, whole-category view of every rule's keywords — kept in sync
// with `terms` here so category-level lookups (which substitute category
// does this term belong to) don't need to re-flatten on every call. Only
// used for category/substitute selection, never for translation (see
// translateTerm) since that must stay scoped to one specific food.
for (const rule of foodRules) {
  rule.keywords = rule.terms.flatMap((t) => t.keywords);
  rule.tamilKeywords = rule.terms.flatMap((t) => t.tamilKeywords || []);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary-aware "is `needle` a bounded word/phrase inside `haystack`"
// check. Plain .includes() would let "nuts" match inside "peanuts", or
// "egg" match inside "eggplant" (and, on the Tamil side, "முட்டை" (egg)
// match inside "முட்டைகோஸ்" (cabbage)) — unrelated foods that merely share
// letters. \p{L}\p{N} (Unicode letter/number) covers Tamil script too,
// unlike a Latin-only [a-z0-9] boundary.
function containsWord(haystack, needle) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

function matchesTerm(term, sub) {
  const t = term.toLowerCase();
  const allKeywords = [...sub.keywords, ...(sub.tamilKeywords || [])];
  return allKeywords.some((kw) => {
    const k = kw.toLowerCase();
    return containsWord(t, k) || containsWord(k, t);
  });
}

/** Whole-category match (for substitute suggestions) — a "curd" allergy is
 * still recognized as belonging to the DAIRY category here. */
function findRuleForTerm(term) {
  const t = (term || '').toLowerCase().trim();
  if (!t) return null;
  return foodRules.find((rule) => rule.terms.some((sub) => matchesTerm(t, sub))) || null;
}

/**
 * Finds the Tamil translation(s) for one *specific* dislike/allergy term —
 * e.g. "curd" -> ["தயிர்"] — without pulling in unrelated Tamil words from
 * the same substitute category (e.g. "ghee"/"milk"/"butter"), which would
 * otherwise cause a curd-only allergy to also flag ghee/milk as if the
 * patient were allergic to those too.
 */
function translateTerm(term) {
  const t = (term || '').toLowerCase().trim();
  if (!t) return [];
  for (const rule of foodRules) {
    const sub = rule.terms.find((s) => matchesTerm(t, s));
    if (sub) return sub.tamilKeywords || [];
  }
  return [];
}

// Scans a block of free text (e.g. a whole recipe's name + ingredient list)
// for ANY category whose keywords appear anywhere in it, returning every
// matching category name — unlike findRuleForTerm above, which asks "is
// this one short term the category" for a single typed dislike/allergy
// word. Used to auto-tag a recipe's allergens (server/scripts/
// build-recipe-library.js) from its own ingredient text, not from anything
// a patient typed.
function categoriesMentionedIn(text) {
  const t = (text || '').toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const rule of foodRules) {
    const found = rule.terms.some((sub) => {
      const allKeywords = [...sub.keywords, ...(sub.tamilKeywords || [])];
      return allKeywords.some((kw) => containsWord(t, kw.toLowerCase()));
    });
    if (found) hits.push(rule.category);
  }
  return hits;
}

module.exports = { foodRules, findRuleForTerm, translateTerm, containsWord, categoriesMentionedIn };
