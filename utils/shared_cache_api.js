/**
 * shared-cache-api.js
 * Client for the Headline FM shared narration cache backend.
 *
 * Cache lookup order (in popup.js):
 *   1. chrome.storage.local  → free, instant, per-device
 *   2. Shared backend (this) → one Gemini call per gender per day across ALL users
 *   3. Gemini API call       → last resort; result is written to both caches
 *
 * Gender is passed as an EXPLICIT separate parameter throughout.
 * The backend builds the composite storage key (categories_gender) server-side.
 * This keeps the client's concern (what to fetch) separate from the server's
 * concern (how to key it in the DB).
 */

/** Canonical categories key: sorted, comma-joined, NO gender suffix. */
export function buildCategoriesKey(categoryIds) {
  return [...categoryIds].sort().join(",");
}

/**
 * Fetch a cached narration from the shared backend.
 * @param {string} backendUrl    - e.g. "https://headlinefm.onrender.com"
 * @param {string} categoriesKey - from buildCategoriesKey()
 * @param {string} gender        - 'female' | 'male'
 * @returns {Promise<string|null>}
 */
export async function fetchSharedNarration(backendUrl, categoriesKey, gender) {
  if (!backendUrl) return null;

  const today = new Date().toISOString().slice(0, 10);
  const url =
    `${backendUrl}/api/narration` +
    `?date=${today}` +
    `&cats=${encodeURIComponent(categoriesKey)}` +
    `&gender=${encodeURIComponent(gender)}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data.narration === "string" ? data.narration : null;
  } catch {
    return null;
  }
}

/**
 * Write a freshly-generated narration to the shared backend (fire-and-forget).
 * @param {string} backendUrl
 * @param {string} categoriesKey - from buildCategoriesKey()
 * @param {string} gender        - 'female' | 'male'
 * @param {string} narration
 * @param {string} [writeSecret]
 */
export async function storeSharedNarration(
  backendUrl,
  categoriesKey,
  gender,
  narration,
  writeSecret = "",
) {
  if (!backendUrl) return;

  const today = new Date().toISOString().slice(0, 10);
  const headers = { "Content-Type": "application/json" };
  if (writeSecret) headers["x-headline-secret"] = writeSecret;

  try {
    await fetch(`${backendUrl}/api/narration`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date: today,
        categories: categoriesKey,
        gender,
        narration,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Fire-and-forget - swallow all errors
  }
}