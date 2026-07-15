/**
 * cache-service.js
 * Thin wrapper around chrome.storage.local for daily news caching.
 * Cache keys are scoped to the current date so they expire automatically.
 */

const MS_PER_DAY = 86_400_000;

/** Returns today's date string: "YYYY-MM-DD" */
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Derive a unique cache key from the date + sorted category list + gender.
 * Gender is included because male/female narrations are distinct (different personas).
 */
export function buildCacheKey(prefix, categories, gender = "") {
  const cats = [...categories].sort().join(",");
  const suffix = gender ? `_${gender}` : "";
  return `${prefix}_${todayKey()}_${cats}${suffix}`;
}

/** Write a value to local storage with a timestamp */
export async function cacheSet(key, value) {
  await chrome.storage.local.set({ [key]: { value, ts: Date.now() } });
}

/**
 * Read a cached value.
 * Returns null if key missing or data is from a previous day.
 */
export async function cacheGet(key) {
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;

  // Invalidate if the entry is older than one day
  if (Date.now() - entry.ts > MS_PER_DAY) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.value;
}

/** Remove a single cache entry */
export async function cacheRemove(key) {
  await chrome.storage.local.remove(key);
}

/** Purge all NewsRep cache entries (leaves settings untouched) */
export async function cachePurge() {
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter((k) => k.startsWith("nr_"));
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}