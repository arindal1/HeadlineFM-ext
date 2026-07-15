# HeadlineFM — Data & Message Flow

Detailed sequence diagrams showing exactly what happens at runtime.

---

## 1. Extension Install Flow

```mermaid
sequenceDiagram
    participant Chrome
    participant SW as service-worker.js
    participant Options as options.js

    Chrome->>SW: onInstalled (reason='install')
    SW->>Chrome: chrome.runtime.openOptionsPage()
    Chrome->>Options: Open options panel
    Options->>Chrome: chrome.storage.sync.get(keys)
    Chrome-->>Options: {} (empty — first run)
    Note over Options: All fields blank; user pastes API keys
    Options->>Chrome: chrome.permissions.request({origins: [backendUrl/*]})
    Chrome-->>Options: granted=true
    Options->>Chrome: chrome.storage.sync.set({newsApiKey, geminiApiKey, backendUrl, ...})
```

---

## 2. Popup Init Flow

```mermaid
sequenceDiagram
    participant DOM
    participant P as popup.js
    participant Store as chrome.storage.sync

    DOM->>P: DOMContentLoaded → init()
    P->>P: setDate() — render date badge
    P->>Store: get([selectedCategories, voiceGender, backendUrl, writeSecret, newsApiKey, geminiApiKey])
    Store-->>P: saved values
    P->>P: renderCategories() — create chip buttons from CATEGORIES
    P->>P: renderPersonaBadge(gender)
    P->>P: bindEvents()
```

---

## 3. Broadcast Flow — Full (Cache Miss on All Tiers)

```mermaid
sequenceDiagram
    participant User
    participant P as popup.js
    participant CS as cache-service.js
    participant SC as shared-cache-api.js
    participant NS as news-service.js
    participant GS as gemini-service.js
    participant TTS as tts-service.js
    participant NewsAPI
    participant Gemini
    participant Backend as Backend API
    participant MongoDB

    User->>P: Click BROADCAST
    P->>P: Validate API keys present
    P->>P: buildCacheKey('nr', categories, gender)

    Note over P,CS: Tier 1 — Local cache
    P->>CS: cacheGet(localCacheKey)
    CS->>CS: chrome.storage.local.get(key)
    CS-->>P: null (miss)

    Note over P,SC: Tier 2 — Shared backend
    P->>SC: fetchSharedNarration(backendUrl, catsKey, gender)
    SC->>Backend: GET /api/narration?date=…&cats=…&gender=…
    Backend->>MongoDB: findOne({date, categoriesKey})
    MongoDB-->>Backend: null
    Backend-->>SC: 404 not_cached
    SC-->>P: null (miss)

    Note over P,NS: Tier 3 — Live fetch
    P->>NS: fetchAllNews(categoryIds, newsApiKey)
    NS->>NewsAPI: parallel fetch (Promise.allSettled)
    NewsAPI-->>NS: articles per category
    NS-->>P: settledResults
    P->>NS: formatNewsForPrompt(settledResults)
    NS-->>P: newsText (plain text block)

    P->>GS: generateNarration(newsText, geminiApiKey, gender)
    GS->>GS: buildPrompt(newsText, date, persona)
    GS->>Gemini: POST /v1beta/models/gemini-2.5-flash:generateContent
    Gemini-->>GS: narration script text
    GS-->>P: narration

    Note over P,CS: Write to both caches
    P->>CS: cacheSet(localCacheKey, narration)
    P->>SC: storeSharedNarration(backendUrl, catsKey, gender, narration) [fire-and-forget]
    SC->>Backend: POST /api/narration {date, categories, gender, narration}
    Backend->>MongoDB: findOneAndUpdate(upsert)
    MongoDB-->>Backend: saved
    Backend-->>SC: 201 Created (ignored by client)

    Note over P,TTS: Playback
    P->>P: displayNarration(narration)
    P->>TTS: speak(narration, gender, geminiApiKey)
    TTS->>Gemini: POST gemini-2.5-flash-preview-tts:generateContent (voice=Aoede/Charon)
    Gemini-->>TTS: base64 PCM audio (24 kHz, 16-bit mono)
    TTS->>TTS: _decodePCM() — base64 → AudioBuffer
    TTS->>TTS: AudioContext.createBufferSource().start()
    loop Every 100 ms
        TTS-->>P: onProgress(charIdx, total)
        P->>P: updateNarrationProgress()
    end
    TTS-->>P: onEnd()
    P->>P: setStatus('ready', 'BROADCAST COMPLETE')
```

---

## 4. Broadcast Flow — Tier 1 Cache Hit (Local)

```mermaid
sequenceDiagram
    participant User
    participant P as popup.js
    participant CS as cache-service.js
    participant TTS as tts-service.js

    User->>P: Click BROADCAST
    P->>CS: cacheGet(localCacheKey)
    CS-->>P: narration string (hit — same day)
    P->>P: displayNarration(narration)
    P->>TTS: speak(narration, gender, geminiApiKey)
    Note over P,TTS: NewsAPI and Gemini narration are never called
```

---

## 5. Broadcast Flow — Tier 2 Cache Hit (Shared Backend)

```mermaid
sequenceDiagram
    participant User
    participant P as popup.js
    participant CS as cache-service.js
    participant SC as shared-cache-api.js
    participant Backend
    participant MongoDB

    User->>P: Click BROADCAST
    P->>CS: cacheGet(localCacheKey) → null
    P->>SC: fetchSharedNarration(backendUrl, catsKey, gender)
    SC->>Backend: GET /api/narration?date=…&cats=…&gender=…
    Backend->>MongoDB: findOne({date, categoriesKey})
    MongoDB-->>Backend: {narration, createdAt}
    Backend-->>SC: 200 {narration}
    SC-->>P: narration string

    P->>CS: cacheSet(localCacheKey, narration)  ← warm local cache
    P->>P: displayNarration + playNarration(text, gender, geminiApiKey)
    Note over P: Gemini narration is never called; NewsAPI is never called
```

---

## 6. Force Refresh Flow

```mermaid
sequenceDiagram
    participant User
    participant P as popup.js
    participant CS as cache-service.js

    User->>P: Click ↺ force refresh
    P->>CS: cachePurge() — remove all 'nr_' keys from storage.local
    CS-->>P: done
    P->>P: broadcast(forceRefresh=true)
    Note over P: Skips both Tier 1 and Tier 2 cache reads
    Note over P: Goes straight to NewsAPI + Gemini
```

---

## 7. Settings Save Flow (with Optional Host Permission)

```mermaid
sequenceDiagram
    participant User
    participant O as options.js
    participant Chrome

    User->>O: Fills in keys + backendUrl + clicks Save
    O->>O: Validate newsApiKey format (/^[a-f0-9]{32}$/)
    O->>O: Validate geminiApiKey startsWith('AIza')
    O->>O: Validate backendUrl startsWith('https://')
    O->>Chrome: chrome.permissions.request({origins: [backendOrigin/*]})
    Chrome-->>User: Permission dialog
    User-->>Chrome: Allow
    Chrome-->>O: granted = true
    O->>Chrome: chrome.storage.sync.set({newsApiKey, geminiApiKey, backendUrl, writeSecret})
    O->>O: showMsg('✓ Settings saved successfully!', 'success')
```

---

## 8. Gemini TTS Audio Pipeline

The `TTSService` calls the Gemini TTS API and plays the result through Web Audio API, eliminating the Chrome Web Speech API ~15-second cutoff entirely.

```mermaid
flowchart TD
    A[Full narration string\n~500–700 words] --> B[Split on paragraph boundaries\n\n\n]
    B --> C[Each paragraph = one TTS chunk\nOversize paragraph → sentence split ≤3 500 chars]
    C --> D[Fetch chunk 0 from Gemini TTS\nvoice = Aoede or Charon]
    D --> E[Gemini returns base64 raw PCM\n16-bit LE · 24 kHz · mono]
    E --> F[_decodePCM\nbase64 → float32 AudioBuffer]
    F --> G[AudioContext.createBufferSource\n.start 0]
    G --> H[setInterval 100 ms\nonProgress callback]
    G --> P[Pre-fetch next chunk in parallel]
    H --> I{Last chunk?}
    I -->|No — next chunk ready| G
    I -->|Yes| J[TTSService.onEnd callback]
```

Pipelining: while chunk N is playing, chunk N+1 is already being fetched from Gemini TTS in parallel, so there is no audible gap between paragraphs.

Chunking strategy: `_chunkText()` always splits on `\n\n` paragraph boundaries first. Each paragraph becomes its own TTS call. Any paragraph longer than 3 500 chars is further split at sentence endings. This means even a short narration is chunked by paragraph — the user hears the first paragraph almost immediately while the rest is fetched.

Cancellation: a `_gen` integer is incremented on every `speak()` and `stop()`. Every async step checks `this._gen === gen` before continuing; stale in-flight fetches are silently discarded.

---

## 9. Module Dependency Graph

```mermaid
graph LR
    popup.js --> news-service.js
    popup.js --> gemini-service.js
    popup.js --> tts-service.js
    popup.js --> cache-service.js
    popup.js --> shared-cache-api.js

    news-service.js --> NewsAPI([NewsAPI.org])
    gemini-service.js --> Gemini([Gemini API\nnarration + TTS])
    cache-service.js --> LocalStorage([chrome.storage.local])
    shared-cache-api.js --> BackendAPI([Backend REST API])

    options.js --> SyncStorage([chrome.storage.sync])
    options.js --> ChromePerms([chrome.permissions])

    BackendAPI --> narration-route[routes/narration.js]
    narration-route --> Narration-model[models/Narration.js]
    Narration-model --> MongoDB[(MongoDB Atlas)]
```

---

## 10. Data Shapes

### News article (internal)
```js
{
  title: string,
  description: string,    // truncated to 120 chars in prompt
  source: string,
}
```

### Gemini request body (simplified)
```js
{
  contents: [{ parts: [{ text: promptString }] }],
  generationConfig: { temperature: 0.88, topP: 0.92, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
  safetySettings: [ /* HARASSMENT, HATE_SPEECH, SEXUALLY_EXPLICIT, DANGEROUS_CONTENT — all BLOCK_MEDIUM_AND_ABOVE */ ]
}
```

### Local cache entry
```js
{ value: "narration script...", ts: 1752499200000 }
```

### Backend POST body
```js
{ date: "2026-07-14", categories: "finance,technology", gender: "female", narration: "..." }
```

### Backend GET response (200)
```js
{ narration: "...", date: "2026-07-14", categoriesKey: "finance,technology_female", gender: "female", cachedAt: "2026-07-14T..." }
```

### MongoDB document (Narration model)
```js
{
  _id: ObjectId,
  date: "2026-07-14",
  categoriesKey: "finance,technology_female",  // sortedCats_gender
  narration: "...",
  categoryCount: 2,      // optional
  createdAt: Date,       // auto TTL index — deleted after 48h
  updatedAt: Date,
}
```