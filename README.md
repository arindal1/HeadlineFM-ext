# 📡 Headline FM - Daily News Narrator

> *Your daily news, narrated with personality. Stay informed, stay entertained.*

A Chromium-based browser extension that fetches today's top headlines across your chosen categories, feeds them to **Google Gemini** to craft a witty, meme-aware narration script, then reads it aloud using a smooth browser voice - all in one click.

A shared backend (Node.js + MongoDB Atlas) means **only one Gemini call is made per day** across all users. Everyone else gets the narration instantly from cache.

---

## Features

| | |
|---|---|
| 📰 **10 categories** | Technology ★, Science, Business, Entertainment, General, Football, F1, UFC, Politics, Finance |
| 🤖 **AI narration** | Gemini 1.5 Flash rewrites dry headlines into an entertaining broadcast |
| � **Anchor personas** | **Maya** (female) - sharp, warm, culturally-aware. **Zane** (male) - smooth, deadpan, dry wit. Two distinct scripts per day |
| 🎙️ **Smooth voice** | Choose Male / Female + any available browser voice (Google/Microsoft neural voices preferred) |
| 💾 **3-tier daily cache** | Local → shared backend → live call. One Gemini call **per gender per day** for all users |
| 🎨 **Retro UI** | CRT scanlines, neon glow, VT323 terminal font, animated audio visualizer |
| 🆓 **100% free stack** | NewsAPI + Gemini + MongoDB Atlas M0 + Render.com |

---

## Project Structure

```
HeadlineFM/
├── manifest.json                    # Chrome Extension Manifest V3 config
│
├── popup/                           # The extension popup (main UI)
│   ├── popup.html                   # Retro terminal layout
│   ├── popup.css                    # CRT scanlines, neon glow, animations
│   └── popup.js                     # Main controller - orchestrates everything
│
├── utils/                           # Shared pure-logic modules
│   ├── news-service.js              # Fetches headlines from NewsAPI.org
│   ├── gemini-service.js            # Calls Gemini 1.5 Flash for narration
│   ├── tts-service.js               # Web Speech API wrapper (chunked + keep-alive)
│   ├── cache-service.js             # Local daily cache via chrome.storage.local
│   └── shared-cache-api.js          # Client for the shared backend cache
│
├── background/
│   └── service-worker.js            # MV3 background SW (opens options on install)
│
├── options/                         # Extension settings page
│   ├── options.html
│   ├── options.css
│   └── options.js
│
├── assets/icons/
│   └── generate-icons.html          # Open in browser to generate PNG icons
│
└── backend/                         # Shared narration cache server
    ├── server.js                    # Express app entry point
    ├── package.json
    ├── .env.example                 # Copy to .env for local dev
    ├── models/
    │   └── Narration.js             # Mongoose schema + TTL index
    └── routes/
        └── narration.js             # GET + POST /api/narration
```

---

## How the Cache Works

```
User clicks BROADCAST
        │
        ▼ ── Tier 1 ──────────────────────────────────────────────────────
        │    chrome.storage.local  (per-device, instant)
        │    Key: "nr_narration_YYYY-MM-DD_cat1,cat2,..._female"
        │                                                  └─ gender suffix
        │    HIT → play immediately
        │
        ▼ ── Tier 2 ──────────────────────────────────────────────────────
        │    Shared MongoDB backend  (cross-user, per gender)
        │    GET /api/narration?date=...&cats=...&gender=female
        │                                          └─ explicit gender param
        │    HIT → warm local cache → play
        │
        ▼ ── Tier 3 ──────────────────────────────────────────────────────
             NewsAPI.org  (parallel fetch across selected categories)
                  │
             Gemini 1.5 Flash  (generates narration as Maya or Zane)
                  │
             Write to BOTH local cache + shared backend (fire-and-forget)
                  │
             display + play via Web Speech API
```

The **first female user** of the day generates Maya's narration. The **first male user** generates Zane's. Everyone after that gets theirs instantly from cache - max 2 Gemini calls per day total, only when actually needed.

---

## Quick Setup

### Step 1 - Get API keys (free)

| Service | Link | Free limits |
|---------|------|-------------|
| NewsAPI | [newsapi.org/register](https://newsapi.org/register) | 100 req/day |
| Google Gemini | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | 15 RPM · 1M tokens/day |

### Step 2 - Generate icons

Open `assets/icons/generate-icons.html` in Chrome. Click **GENERATE & DOWNLOAD ICONS**.
Move `icon16.png`, `icon48.png`, `icon128.png` into `assets/icons/`.

### Step 3 - Load the extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `HeadlineFM` folder
4. The 📡 icon appears in your toolbar

### Step 4 - Add your API keys

Click the toolbar icon → ⚙ Settings → paste your NewsAPI and Gemini keys → Save.

### Step 5 (optional) - Deploy the shared backend

See [WORKFLOW.md](WORKFLOW.md) § "Phase 7 - Backend" for full instructions.
Short version: deploy `backend/` to [Render.com](https://render.com) (free), connect a [MongoDB Atlas](https://mongodb.com/atlas) M0 cluster (free), paste the server URL into extension Settings.

> When you save a backend URL in Settings, Chrome will show a **permission prompt** asking to connect to that domain. Click **Allow** - the shared cache will not work without it. This is by design: the extension only requests permission for the exact origin you enter, not all websites.

---

## Usage

1. Click the 📡 **Headline FM** toolbar icon
2. Toggle the **category chips** you want (TECH is pre-selected ★)
3. Choose **♀ FEMALE** or **♂ MALE** anchor voice, and optionally pick a specific voice
4. Hit **📻 BROADCAST TODAY'S NEWS**
5. Keep the popup open while listening - Chrome stops audio when the popup closes

> **↺ force refresh** - bypasses all caches and fetches completely fresh news + a new narration.

---

## API Notes

**Anchor personas**
- **Maya** (female) - sharp, warm, biting. Samantha Bee energy. Addresses the listener directly. Empathetic to people, ruthless to absurdity.
- **Zane** (male) - smooth, dry-humoured, deadpan. John Mulaney/tech-Twitter vibe. Delivers niche references without overselling them.
- Each gender gets a fully separate Gemini prompt and a separate cache entry. Switching gender fetches a genuinely different script, not just a different voice reading the same text.

**NewsAPI**
- Free developer plan - no commercial use, ~15 min article delay.
- Standard categories (`/top-headlines`): Technology, Science, Business, Entertainment, General.
- Custom queries (`/everything?q=`): Football, F1, UFC, Politics, Finance.

**Gemini 1.5 Flash**
- Free tier: 15 requests/minute, 1 million tokens/day.
- Temperature 0.88 → creative but coherent narration.
- Prompt instructs: late-night-host energy, Gen-Z slang, meme references, short punchy sentences.

**Web Speech API**
- Fully local - synthesizes in the browser, zero HTTP calls, no cost.
- Voice quality by OS: Windows (Microsoft Jenny/Aria - excellent), macOS (Samantha - good), Chrome (Google US English - excellent, requires internet).
- TTS is intentionally NOT cached in the shared backend - it runs locally per user and preserves individual voice preferences.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| *"API keys not set"* | Open ⚙ Settings, save both keys |
| *NewsAPI key invalid* | Must be a 32-character hex string |
| *Gemini key invalid* | Must start with `AIza` |
| *Shared cache - permission prompt appeared* | Click **Allow** when Chrome asks for permission after saving the backend URL |
| *Shared cache - still not working* | Backend URL must start with `https://`; verify the Render service is live at `/health` |
| *Audio stops after ~15 s* | Known Chrome bug - keep-alive timer handles it. If it still stops, click ▶ |
| *Audio stops when popup closes* | Chrome limitation - keep popup open while listening |
| *No voices in dropdown* | Voices load async; click ▶ Play once to trigger load |
| *Icons missing / grey puzzle piece* | Run `generate-icons.html` and place the 3 PNGs in `assets/icons/` |

---

## License

MIT - free to use and modify for personal projects. Not for commercial distribution.

