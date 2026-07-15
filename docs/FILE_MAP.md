# HeadlineFM — File Reference

Every source file, what it exports, and what it depends on.

---

## Extension root

### `manifest.json`
Chrome Extension Manifest V3 config.

- **Version:** 1.5.1
- **Popup:** `popup/popup.html`
- **Options page:** `options/options.html` (opens in panel)
- **Background:** `background/service-worker.js` (ES module)
- **Static permissions:** `storage`, `https://newsapi.org/*`, `https://generativelanguage.googleapis.com/*`
- **Optional permissions:** `https://*/*` (for user-entered backend URL)

---

## popup/

### `popup.html`
Retro terminal UI shell. Defines all DOM ids referenced by `popup.js`.

Key element IDs: `dateBadge`, `statusDot`, `statusText`, `onAirBadge`, `categoriesGrid`, `voiceFemale`, `voiceMale`, `visualizer`, `narrationBox`, `narrationIdle`, `narrationBody`, `spokenText`, `unspokenText`, `progressFill`, `progressPct`, `restartBtn`, `playPauseBtn`, `stopBtn`, `broadcastBtn`, `broadcastLabel`, `refreshLink`, `settingsBtn`, `msgBox`, `msgText`, `personaBadge`.

### `popup.css`
CRT scanline aesthetic: neon glow, VT323 terminal font, animated audio visualizer bars, category chip styles.

### `popup.js`
**The main controller.** Imports everything and orchestrates the full broadcast flow.

**Imports:**
```
news-service.js  → CATEGORIES, fetchAllNews, formatNewsForPrompt
gemini-service.js → generateNarration, PERSONAS
tts-service.js   → TTSService
cache-service.js → cacheGet, cacheSet, buildCacheKey, cachePurge
shared-cache-api.js → buildCategoriesKey, fetchSharedNarration, storeSharedNarration
```

**App state object:**
```js
{
  selectedCategories: Set,    // default: {'technology'}
  voiceGender: string,        // 'female' | 'male'
  narration: string,
  isLoading: bool,
  isPlaying: bool,
  isPaused: bool,
  backendUrl: string,
  writeSecret: string,
  newsApiKey: string,
  geminiApiKey: string,       // also passed directly to TTSService.speak()
}
```

**Key functions:**

| Function | What it does |
|----------|-------------|
| `init()` | Sets date badge, loads settings, renders categories, renders persona badge, binds events |
| `loadSettings()` | Reads `chrome.storage.sync`, hydrates state + UI |
| `saveSettings()` | Debounced (400 ms) write of categories/gender to `chrome.storage.sync` |
| `renderCategories()` | Creates category chip buttons from `CATEGORIES` constant |
| `toggleCategory(id)` | Adds/removes category from state; enforces ≥1 selected |
| `setGender(gender)` | Updates state, renders persona badge |
| `renderPersonaBadge(gender)` | Shows anchor name + first-sentence description blurb |
| `broadcast(forceRefresh)` | **Core orchestration** — runs 3-tier cache lookup, then Gemini call |
| `displayNarration(text)` | Populates narration box; splits into spoken/unspoken spans |
| `updateNarrationProgress(charIdx, total)` | Scrolls text; highlights spoken vs unspoken |
| `playNarration(text)` | Calls `tts.speak(text, gender, geminiApiKey)` |
| `handlePlayPause()` | Toggles play/pause on existing narration |
| `handleStop()` | Stops TTS, resets player UI |
| `handleRestart()` | Restarts from beginning |

**`broadcast()` flow (simplified):**
```
1. Validate API keys present
2. Build localCacheKey from date + categories + gender
3. Try cacheGet(localCacheKey) → play if hit
4. Try fetchSharedNarration(backendUrl, catsKey, gender) → warm local + play if hit
5. fetchAllNews(categories, newsApiKey) [parallel]
6. generateNarration(newsText, geminiApiKey, gender)
7. cacheSet(localCacheKey, narration)
8. storeSharedNarration(backendUrl, ...) [fire-and-forget]
9. displayNarration() + playNarration()
```

---

## utils/

### `news-service.js`
NewsAPI.org client. No dependencies outside standard `fetch`.

**Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `CATEGORIES` | `Array<CategoryConfig>` | 10 category definitions with id, label, icon, API type, query param |
| `fetchCategory(cat, apiKey)` | `async fn` | Fetches one category; returns `{category, id, articles[]}` |
| `fetchAllNews(categoryIds, apiKey)` | `async fn` | `Promise.allSettled` over all selected categories |
| `formatNewsForPrompt(settledResults)` | `fn` | Converts settled results to a plain-text block for the Gemini prompt |

**Category types:**
- `"headlines"` → `GET /v2/top-headlines?category=…` (Technology, Science, Business, Entertainment, General)
- `"everything"` → `GET /v2/everything?q=…&sortBy=publishedAt` (Football, F1, UFC, Politics, Finance)

---

### `gemini-service.js`
Google Gemini 2.5 Flash client.

**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

**Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `PERSONAS` | `object` | `{ female: PersonaConfig, male: PersonaConfig }` |
| `generateNarration(newsText, apiKey, gender)` | `async fn` | Builds prompt, calls Gemini, returns narration string |

**Generation config:** temperature `0.88`, topP `0.92`, maxOutputTokens `8192`, `thinkingBudget: 0` (thinking disabled — prevents reasoning tokens from consuming the output budget, eliminating the ~1 000-token truncation on 2.5 Flash).

**`buildPrompt(newsText, dateStr, persona)`** — internal; constructs the full LLM system + user prompt including persona description, delivery style, and strict output rules.

---

### `tts-service.js`
Gemini TTS API client + Web Audio API playback. No imports.

**Fixed broadcast voices:**
| Gender | Voice | Character |
|--------|-------|-----------|
| Female | `Aoede` | Warm, breezy, natural-sounding |
| Male | `Charon` | Deep, firm, authoritative |

Voices are hard-coded — there is no user selection. This ensures consistent broadcast quality on every OS and browser.

**Class: `TTSService`**

| Member | Description |
|--------|-------------|
| `speak(text, gender, apiKey)` | Fetches audio from Gemini TTS, decodes PCM, plays via Web Audio API |
| `pause()` | `AudioContext.suspend()` — pauses at exact sample boundary |
| `resume()` | `AudioContext.resume()` — continues from paused position |
| `stop()` | Cancels in-flight requests, destroys AudioContext |
| `onStart` | Callback `()` — fired when first audio chunk begins |
| `onProgress` | Callback `(charIndex, total)` — fired every 100 ms during playback |
| `onEnd` | Callback `()` — fired after last audio chunk ends |
| `onError` | Callback `(errorMsg)` — fired on API or decode error |

**Audio pipeline:**
- Calls `gemini-2.5-flash-preview-tts:generateContent` with the narration text
- Response is base64 raw PCM: 16-bit signed little-endian · 24 kHz · mono
- `_decodePCM(base64)` converts it to a float32 `AudioBuffer`
- `_playBuffer(audioBuffer, gen)` plays it via a `BufferSourceNode`
- `_chunkText()` always splits on `\n\n` paragraph boundaries — **each paragraph is a separate TTS API call**. Oversized paragraphs fall back to sentence-level splitting (hard ceiling: 3 500 chars). Chunk N+1 is pre-fetched while chunk N is playing, so there are no audible gaps.
- Cancellation token (`_gen`) ensures stop/restart never plays stale audio

---

### `cache-service.js`
`chrome.storage.local` daily cache wrapper. No imports.

**Exports:**

| Export | Description |
|--------|-------------|
| `todayKey()` | Returns `"YYYY-MM-DD"` |
| `buildCacheKey(prefix, categories, gender)` | Builds `"{prefix}_{date}_{sorted-cats}_{gender}"` |
| `cacheSet(key, value)` | Stores `{value, ts: Date.now()}` |
| `cacheGet(key)` | Returns value or `null` (invalidates if older than 24 h) |
| `cacheRemove(key)` | Removes one key |
| `cachePurge()` | Removes all keys starting with `"nr_"` (leaves settings intact) |

---

### `shared-cache-api.js`
HTTP client for the shared backend. Uses `fetch` with `AbortSignal.timeout`.

**Exports:**

| Export | Description |
|--------|-------------|
| `buildCategoriesKey(categoryIds)` | Sorted comma-joined string — **no gender suffix** |
| `fetchSharedNarration(backendUrl, categoriesKey, gender)` | `GET /api/narration` → string or null |
| `storeSharedNarration(backendUrl, categoriesKey, gender, narration, writeSecret)` | `POST /api/narration` — fire-and-forget, swallows all errors |

Timeouts: GET 8 s · POST 10 s.

---

## options/

### `options.html`
Settings panel HTML. Fields: `newsApiKey`, `geminiApiKey`, `backendUrl`, `writeSecret`. Each key field has a show/hide toggle button.

### `options.css`
Matches popup retro aesthetic.

### `options.js`
Settings page controller. No module imports.

**Key functions:**

| Function | Description |
|----------|-------------|
| `loadKeys()` | Reads `chrome.storage.sync`, populates inputs |
| `saveKeys()` | Validates formats, requests optional host permission for backend URL, writes to `chrome.storage.sync` |
| `toggleWriteSecretVisibility()` | Shows write-secret field only when backend URL is filled |
| `showMsg(text, type)` | Displays a timed success/error message banner |

**Validation rules:**
- NewsAPI key: must match `/^[a-f0-9]{32}$/i`
- Gemini key: must start with `"AIza"`
- Backend URL: must start with `"https://"`

---

## background/

### `service-worker.js`
Minimal MV3 background service worker.

- Listens for `chrome.runtime.onInstalled`
- On `reason === 'install'`: calls `chrome.runtime.openOptionsPage()`
- No other logic; the SW stays idle otherwise

---

## backend/

### `server.js`
Express app entry point.

- Loads `dotenv`
- CORS: `*`, methods `GET POST`
- Body limit: 25 KB JSON
- Mounts `narrationRoutes` at `/api/narration`
- Exposes `/health` → `{status: "ok", ts}`
- Requires `MONGODB_URI` env var; exits on missing or connection failure
- Default port: `3000` (overridden by `PORT` env var on Render)

**Env vars:**
| Var | Required | Description |
|-----|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `PORT` | No | HTTP port (Render sets this automatically) |
| `WRITE_SECRET` | No | Optional shared secret for POST protection |

---

### `routes/narration.js`
Express router for `/api/narration`.

**GET handler:**
1. Validates `date` (regex) and `cats` (1–10 comma-separated IDs)
2. Normalises gender (defaults to `'female'`)
3. Builds composite `categoriesKey = "{sortedCats}_{gender}"`
4. Queries MongoDB for `{date, categoriesKey}`
5. Returns 200 with narration or 404 `{error: 'not_cached'}`

**POST handler:**
1. Checks `X-HeadlineFM-Secret` header if `WRITE_SECRET` env is set
2. Validates all fields
3. Upserts via `findOneAndUpdate(..., {upsert: true})` — idempotent
4. Returns 201 on creation, 200 on update

Rate limits: GET 30/min · POST 5/min (`express-rate-limit`).

---

### `models/Narration.js`
Mongoose schema.

**Fields:** `date` (String, YYYY-MM-DD), `categoriesKey` (String), `narration` (String), `categoryCount` (Number, optional), `createdAt`/`updatedAt` (timestamps).

**Indexes:**
- Compound unique: `{date: 1, categoriesKey: 1}` — prevents duplicate entries
- TTL: `{createdAt: 1}`, `expireAfterSeconds: 172800` (48 hours auto-delete)

---

## assets/icons/

### `generate-icons.html`
Standalone HTML file — open in Chrome to generate and download `icon16.png`, `icon48.png`, `icon128.png`. Uses Canvas API. Not part of the extension bundle.