/**
 * popup.js — Headline FM main popup controller
 * Orchestrates: settings · category selection · news fetch · AI narration · TTS playback
 */

import { CATEGORIES, fetchAllNews, formatNewsForPrompt } from "../utils/news-service.js";
import { generateNarration, PERSONAS } from "../utils/gemini-service.js";
import { TTSService } from "../utils/tts-service.js";
import { cacheGet, cacheSet, buildCacheKey, cachePurge } from "../utils/cache-service.js";
import { buildCategoriesKey, fetchSharedNarration, storeSharedNarration } from "../utils/shared-cache-api.js";

/* - Singleton TTS instance - */
const tts = new TTSService();

/* - App state - */
const state = {
  selectedCategories: new Set(["technology"]),
  voiceGender: "female",
  selectedVoiceName: null, // user-picked specific voice (optional)
  narration: "",
  isLoading: false,
  isPlaying: false,
  isPaused: false,
  backendUrl: "", // shared cache backend URL
  writeSecret: "", // optional backend write secret
  // API keys loaded once at init — avoids storage round-trip on every broadcast
  newsApiKey: "",
  geminiApiKey: "",
};

/* - DOM shortcuts - */
const $ = (id) => document.getElementById(id);
const el = {
  dateBadge: $("dateBadge"),
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  onAir: $("onAirBadge"),
  categoriesGrid: $("categoriesGrid"),
  voiceFemale: $("voiceFemale"),
  voiceMale: $("voiceMale"),
  voiceSelect: $("voiceSelect"),
  visualizer: $("visualizer"),
  narrationBox: $("narrationBox"),
  narrationIdle: $("narrationIdle"),
  narrationBody: $("narrationBody"),
  spokenText: $("spokenText"),
  unspokenText: $("unspokenText"),
  progressFill: $("progressFill"),
  progressPct: $("progressPct"),
  restartBtn: $("restartBtn"),
  playPauseBtn: $("playPauseBtn"),
  stopBtn: $("stopBtn"),
  broadcastBtn: $("broadcastBtn"),
  broadcastLabel: $("broadcastLabel"),
  refreshLink: $("refreshLink"),
  settingsBtn: $("settingsBtn"),
  msgBox: $("msgBox"),
  msgText: $("msgText"),
  personaBadge: $("personaBadge"),
};

/* INIT */
async function init() {
  setDate();
  await loadSettings();
  renderCategories();
  populateVoices();
  renderPersonaBadge(state.voiceGender);
  bindEvents();
}

function setDate() {
  const now = new Date();
  el.dateBadge.textContent = now
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

async function loadSettings() {
  const data = await chrome.storage.sync.get([
    "selectedCategories",
    "voiceGender",
    "voiceName",
    "backendUrl",
    "writeSecret",
    "newsApiKey",
    "geminiApiKey",
  ]);

  if (data.selectedCategories?.length) {
    state.selectedCategories = new Set(data.selectedCategories);
  }
  if (data.voiceGender) state.voiceGender = data.voiceGender;
  if (data.voiceName) state.selectedVoiceName = data.voiceName;
  if (data.backendUrl) state.backendUrl = data.backendUrl.replace(/\/$/, "");
  if (data.writeSecret) state.writeSecret = data.writeSecret;
  if (data.newsApiKey) state.newsApiKey = data.newsApiKey;
  if (data.geminiApiKey) state.geminiApiKey = data.geminiApiKey;

  // Reflect voice gender in toggle
  el.voiceFemale.classList.toggle("active", state.voiceGender === "female");
  el.voiceMale.classList.toggle("active", state.voiceGender === "male");
  el.voiceFemale.setAttribute("aria-checked", state.voiceGender === "female");
  el.voiceMale.setAttribute("aria-checked", state.voiceGender === "male");
}

/* Debounced settings writer — coalesces rapid storage writes (e.g. quick category toggling). */
let _saveTimer = null;
async function saveSettings() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    chrome.storage.sync.set({
      selectedCategories: [...state.selectedCategories],
      voiceGender: state.voiceGender,
      voiceName: state.selectedVoiceName || "",
    });
  }, 400);
}

/* CATEGORIES */
function renderCategories() {
  el.categoriesGrid.innerHTML = "";

  for (const cat of CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = `cat-btn${state.selectedCategories.has(cat.id) ? " active" : ""}`;
    btn.dataset.id = cat.id;
    btn.title = cat.label;
    btn.setAttribute("aria-pressed", state.selectedCategories.has(cat.id));
    btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span class="cat-label">${cat.label}</span>`;
    btn.addEventListener("click", () => toggleCategory(cat.id, btn));
    el.categoriesGrid.appendChild(btn);
  }
}

function toggleCategory(id, btn) {
  if (state.selectedCategories.has(id)) {
    // Must keep at least one selected
    if (state.selectedCategories.size === 1) return;
    state.selectedCategories.delete(id);
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", false);
  } else {
    state.selectedCategories.add(id);
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", true);
  }
  saveSettings();
}

/* VOICE SELECTION */
function populateVoices() {
  const doPopulate = () => {
    const voices = tts.getVoices(state.voiceGender);
    el.voiceSelect.innerHTML = "";

    if (!voices.length) {
      const opt = document.createElement("option");
      opt.textContent = "System default";
      el.voiceSelect.appendChild(opt);
      return;
    }

    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name
        .replace("Microsoft ", "")
        .replace(" Online (Natural)", "");
      if (v.name === state.selectedVoiceName) opt.selected = true;
      el.voiceSelect.appendChild(opt);
    }
  };

  // Voices may not be ready yet on first call
  if (speechSynthesis.getVoices().length) {
    doPopulate();
  } else {
    speechSynthesis.addEventListener("voiceschanged", doPopulate, {
      once: true,
    });
  }
}

/* EVENT BINDINGS */
function bindEvents() {
  // Voice gender toggle
  el.voiceFemale.addEventListener("click", () => setGender("female"));
  el.voiceMale.addEventListener("click", () => setGender("male"));

  // Specific voice dropdown
  el.voiceSelect.addEventListener("change", () => {
    state.selectedVoiceName = el.voiceSelect.value || null;
    saveSettings();
  });

  // Settings page
  el.settingsBtn.addEventListener("click", () =>
    chrome.runtime.openOptionsPage(),
  );

  // Main broadcast
  el.broadcastBtn.addEventListener("click", () => broadcast(false));

  // Force refresh (bypass cache)
  el.refreshLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await cachePurge();
    broadcast(true);
  });

  // Player controls
  el.playPauseBtn.addEventListener("click", handlePlayPause);
  el.stopBtn.addEventListener("click", handleStop);
  el.restartBtn.addEventListener("click", handleRestart);

  // TTS callbacks
  tts.onStart = () => {
    state.isPlaying = true;
    state.isPaused = false;
    setStatus("playing", "ON AIR");
    showOnAir(true);
    setVisualizer(true);
    setPlayerControls(true);
    el.narrationBox.classList.add("active");
  };

  tts.onProgress = (charIdx, total) => {
    updateNarrationProgress(charIdx, total);
    const pct = Math.round((charIdx / total) * 100);
    el.progressFill.style.width = `${pct}%`;
    el.progressPct.textContent = `${pct}%`;
  };

  tts.onEnd = () => {
    state.isPlaying = false;
    state.isPaused = false;
    setStatus("ready", "BROADCAST COMPLETE");
    showOnAir(false);
    setVisualizer(false);
    el.progressFill.style.width = "100%";
    el.progressPct.textContent = "100%";
    setPlayIcon("play");
  };

  tts.onError = (err) => {
    state.isPlaying = false;
    showMessage(`TTS error: ${err}`, "error");
    setStatus("error", "TTS ERROR");
    showOnAir(false);
    setVisualizer(false);
  };
}

function setGender(gender) {
  state.voiceGender = gender;
  el.voiceFemale.classList.toggle("active", gender === "female");
  el.voiceMale.classList.toggle("active", gender === "male");
  el.voiceFemale.setAttribute("aria-checked", gender === "female");
  el.voiceMale.setAttribute("aria-checked", gender === "male");
  populateVoices();
  renderPersonaBadge(gender);
  saveSettings();
}

/** Render the anchor name + personality blurb under the voice toggle */
function renderPersonaBadge(gender) {
  const p = PERSONAS[gender];
  if (!p || !el.personaBadge) return;
  // One-line teaser pulled from the first sentence of description
  const teaser = p.description.trim().split("\n")[0].trim();
  el.personaBadge.innerHTML = `<span class="anchor-name">${p.name.toUpperCase()}</span>&nbsp;&nbsp;${teaser}`;
}

/* PLAYER CONTROLS */
function handlePlayPause() {
  if (!state.narration) return;

  if (!state.isPlaying) {
    // Start fresh
    playNarration(state.narration);
  } else if (state.isPaused) {
    tts.resume();
    state.isPaused = false;
    setPlayIcon("pause");
    setStatus("playing", "ON AIR");
    setVisualizer(true);
    showOnAir(true);
  } else {
    tts.pause();
    state.isPaused = true;
    setPlayIcon("play");
    setStatus("paused", "PAUSED");
    setVisualizer(false);
    showOnAir(false);
  }
}

function handleStop() {
  tts.stop();
  state.isPlaying = false;
  state.isPaused = false;
  setStatus("ready", "READY TO BROADCAST");
  showOnAir(false);
  setVisualizer(false);
  setPlayIcon("play");
  el.progressFill.style.width = "0%";
  el.progressPct.textContent = "0%";
  // Reset narration display to start
  if (state.narration) {
    el.spokenText.textContent = "";
    el.unspokenText.textContent = state.narration;
    el.narrationBox.scrollTop = 0;
  }
}

function handleRestart() {
  tts.stop();
  if (state.narration) {
    setTimeout(() => playNarration(state.narration), 100);
  }
}

/* 
   MAIN BROADCAST FLOW
   3-tier cache: local storage → shared backend → Gemini
*/

async function broadcast(forceRefresh = false) {
  if (state.isLoading) return;

  hideMessage();
  tts.stop();

  // API keys live in state (loaded once at init) — no storage round-trip needed.
  if (!state.newsApiKey || !state.geminiApiKey) {
    showMessage(
      '⚙ API keys not set. <a href="#" id="goSettings">Open Settings</a> to add your free NewsAPI and Gemini keys.',
      "error",
    );
    document.getElementById("goSettings")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const categories = [...state.selectedCategories];
  const gender = state.voiceGender;
  const localCacheKey = buildCacheKey("nr_narration", categories, gender);
  const catsKey = buildCategoriesKey(categories); // gender passed separately, not embedded

  // - Tier 1: Local device cache (instant)
  if (!forceRefresh) {
    const localHit = await cacheGet(localCacheKey);
    if (localHit) {
      showMessage(
        "Using today's cached broadcast. Click ↺ to refresh.",
        "info",
      );
      displayNarration(localHit);
      playNarration(localHit);
      return;
    }
  }

  // - Tier 2: Shared backend cache (per-gender, one Gemini call/day)
  if (!forceRefresh && state.backendUrl) {
    setLoading(true, "CHECKING CACHE...");
    const sharedHit = await fetchSharedNarration(
      state.backendUrl,
      catsKey,
      gender,
    );
    if (sharedHit) {
      await cacheSet(localCacheKey, sharedHit);
      setLoading(false);
      showMessage("Loaded from shared broadcast cache.", "info");
      displayNarration(sharedHit);
      playNarration(sharedHit);
      return;
    }
  }

  // - Tier 3: Fetch live news + call Gemini
  setLoading(true, "FETCHING NEWS...");

  let settledNews;
  try {
    settledNews = await fetchAllNews(categories, state.newsApiKey);
  } catch (err) {
    setLoading(false);
    showMessage(`News fetch failed: ${err.message}`, "error");
    setStatus("error", "FETCH FAILED");
    return;
  }

  const successCount = settledNews.filter(
    (r) => r.status === "fulfilled",
  ).length;
  if (successCount === 0) {
    setLoading(false);
    const reason = settledNews[0]?.reason?.message || "Unknown error";
    showMessage(`All category fetches failed: ${reason}`, "error");
    setStatus("error", "FETCH FAILED");
    return;
  }

  const newsText = formatNewsForPrompt(settledNews);
  const anchorName = PERSONAS[gender]?.name || "AI";
  setStatus("loading", `${anchorName.toUpperCase()} IS WRITING...`);
  setBroadcastLabel(`${anchorName.toUpperCase()} IS ON IT...`);

  let narration;
  try {
    narration = await generateNarration(newsText, state.geminiApiKey, gender);
  } catch (err) {
    setLoading(false);
    showMessage(`Gemini error: ${err.message}`, "error");
    setStatus("error", "NARRATION FAILED");
    return;
  }

  // - Store in both caches (gender-scoped)
  await cacheSet(localCacheKey, narration);
  storeSharedNarration(
    state.backendUrl,
    catsKey,
    gender,
    narration,
    state.writeSecret,
  );

  setLoading(false);

  if (successCount < categories.length) {
    const failed = settledNews.filter((r) => r.status === "rejected").length;
    showMessage(
      `${failed} categor${failed === 1 ? "y" : "ies"} failed to load — broadcast continues with available news.`,
      "info",
    );
  }

  displayNarration(narration);
  playNarration(narration);
}

/* NARRATION DISPLAY */
function displayNarration(text) {
  state.narration = text;
  el.narrationIdle.style.display = "none";
  el.narrationBody.style.display = "block";
  el.spokenText.textContent = "";
  el.unspokenText.textContent = text;
  el.narrationBox.classList.add("active");
  el.narrationBox.scrollTop = 0;

  // Enable player controls
  setPlayerControls(true);
  el.progressFill.style.width = "0%";
  el.progressPct.textContent = "0%";
}

function updateNarrationProgress(charIdx, total) {
  const text = state.narration;
  el.spokenText.textContent = text.slice(0, charIdx);
  el.unspokenText.textContent = text.slice(charIdx);

  // Auto-scroll to keep cursor visible
  const ratio = charIdx / Math.max(total, 1);
  const maxScroll = el.narrationBox.scrollHeight - el.narrationBox.clientHeight;
  el.narrationBox.scrollTop = ratio * maxScroll;
}

/* TTS PLAYBACK */
function playNarration(text) {
  // Resolve user-selected specific voice (if any) and hand it to TTSService
  // via setOverrideVoice() — no monkey-patching of internal methods.
  if (state.selectedVoiceName) {
    const picked = speechSynthesis
      .getVoices()
      .find((v) => v.name === state.selectedVoiceName);
    tts.setOverrideVoice(picked || null);
  } else {
    tts.setOverrideVoice(null); // let TTSService auto-pick best voice for gender
  }
  tts.speak(text, state.voiceGender);
}

/* UI HELPERS */
function setLoading(on, label = "BROADCASTING...") {
  state.isLoading = on;
  el.broadcastBtn.disabled = on;
  el.broadcastBtn.classList.toggle("loading", on);
  setBroadcastLabel(on ? label : "BROADCAST TODAY'S NEWS");
  if (on) setStatus("loading", label);
}

function setBroadcastLabel(text) {
  el.broadcastLabel.textContent = text;
}

/** @param {'ready'|'loading'|'playing'|'paused'|'error'} type */
function setStatus(type, text) {
  el.statusDot.className = `status-dot ${type}`;
  el.statusText.textContent = text;
}

function showOnAir(visible) {
  el.onAir.classList.toggle("visible", visible);
}

function setVisualizer(playing) {
  el.visualizer.classList.toggle("playing", playing);
}

function setPlayerControls(enabled) {
  el.playPauseBtn.disabled = !enabled;
  el.stopBtn.disabled = !enabled;
  el.restartBtn.disabled = !enabled;
}

function setPlayIcon(which) {
  el.playPauseBtn.querySelector(".icon-play").style.display =
    which === "play" ? "" : "none";
  el.playPauseBtn.querySelector(".icon-pause").style.display =
    which === "pause" ? "" : "none";
  el.playPauseBtn.setAttribute(
    "aria-label",
    which === "play" ? "Play" : "Pause",
  );
}

/** @param {string} html   @param {'error'|'info'|'success'} type */
function showMessage(html, type = "info") {
  el.msgBox.className = `msg-box ${type}`;
  el.msgText.innerHTML = html;
  el.msgBox.style.display = "block";
  el.msgBox.classList.add("slide-in");
}

function hideMessage() {
  el.msgBox.style.display = "none";
  el.msgBox.classList.remove("slide-in");
}

/* VISUALIZER — generate bars */
function buildVisualizer() {
  el.visualizer.innerHTML = "";
  for (let i = 0; i < 24; i++) {
    const bar = document.createElement("span");
    bar.className = "bar";
    el.visualizer.appendChild(bar);
  }
}

/* - Boot - */
document.addEventListener("DOMContentLoaded", async () => {
  buildVisualizer();
  await init();
});
