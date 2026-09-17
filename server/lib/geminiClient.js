// Shared low-level Gemini caller — factored out of geminiSuggest.js and
// geminiRecipeSuggest.js, which used to duplicate this exact fetch/timeout
// logic with no retry at all. A 503 "This model is currently experiencing
// high demand... temporary" is Google's own explicit "try again" signal
// (same for 429 RESOURCE_EXHAUSTED) — reported by the user as "Gemini AI not
// working" when it was really just one un-retried transient blip surfacing
// as a hard failure. Retried here with a short backoff; everything else
// (a real timeout via AbortController, a bad API key, a malformed request)
// still fails on the first attempt, since retrying those wouldn't help and
// would just make the caller wait longer for the same outcome.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const RETRYABLE_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} prompt
 * @param {object} responseSchema - Gemini `responseSchema` object
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<object>} the parsed JSON response body (already validated against responseSchema by Gemini)
 */
async function callGemini(prompt, responseSchema, { timeoutMs = 20_000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Set only when this attempt hit a retryable status with attempts left —
    // `return`/`throw` inside the try below exit the function immediately
    // and never reach the backoff sleep past the loop body's end, so a real
    // error (a bad key, a malformed request) or a timeout (AbortError) can
    // never be retried by accident, only this one explicit case.
    let retryable = null;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text();
        const err = new Error(`Gemini API returned ${res.status}: ${bodyText}`);
        if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
          retryable = err;
        } else {
          throw err;
        }
      } else {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini response had no content');
        return JSON.parse(text);
      }
    } finally {
      clearTimeout(timeout);
    }
    lastErr = retryable;
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250);
  }
  throw lastErr;
}

module.exports = { callGemini };
