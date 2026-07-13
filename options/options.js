/**
 * options.js — HeadlineFM Settings Page
 * Handles API key storage and display.
 */

const $ = (id) => document.getElementById(id);

async function init() {
  await loadKeys();
  bindEvents();
}

/* - Load & display saved keys - */
async function loadKeys() {
  const data = await chrome.storage.sync.get([
    "newsApiKey",
    "geminiApiKey",
    "backendUrl",
    "writeSecret",
  ]);

  if (data.newsApiKey) $("newsApiKey").value = data.newsApiKey;
  if (data.geminiApiKey) $("geminiApiKey").value = data.geminiApiKey;
  if (data.backendUrl) $("backendUrl").value = data.backendUrl;
  if (data.writeSecret) $("writeSecret").value = data.writeSecret;

  // Show write-secret field only when backend URL is filled in
  toggleWriteSecretVisibility();
}

/* - Save keys - */
async function saveKeys() {
  const newsKey = $("newsApiKey").value.trim();
  const geminiKey = $("geminiApiKey").value.trim();
  const backendUrl = $("backendUrl").value.trim();
  const secret = $("writeSecret").value.trim();

  // Basic format validation
  if (newsKey && !/^[a-f0-9]{32}$/i.test(newsKey)) {
    showMsg(
      "NewsAPI key looks invalid — it should be a 32-character hex string.",
      "error",
    );
    return;
  }
  if (geminiKey && !geminiKey.startsWith("AIza")) {
    showMsg('Gemini key looks invalid — it should start with "AIza".', "error");
    return;
  }
  if (backendUrl && !backendUrl.startsWith("https://")) {
    showMsg("Backend URL must start with https://", "error");
    return;
  }

  // Request host permission for the backend URL so the extension can fetch from it.
  // optional_host_permissions in manifest.json enables this without broad permissions.
  if (backendUrl) {
    try {
      const origin = new URL(backendUrl).origin;
      const granted = await chrome.permissions.request({
        origins: [`${origin}/*`],
      });
      if (!granted) {
        showMsg(
          "Permission for the backend URL was denied — shared cache will not work. You can try again.",
          "error",
        );
        return;
      }
    } catch {
      showMsg("Backend URL format is invalid.", "error");
      return;
    }
  }

  await chrome.storage.sync.set({
    newsApiKey: newsKey,
    geminiApiKey: geminiKey,
    backendUrl: backendUrl,
    writeSecret: secret,
  });
  showMsg("✓ Settings saved successfully!", "success");
}

/* - Bind events - */
function bindEvents() {
  $("saveBtn").addEventListener("click", saveKeys);

  // Toggle show/hide for password fields
  document.querySelectorAll(".toggle-vis-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = $(targetId);
      input.type = input.type === "password" ? "text" : "password";
    });
  });

  // Save on Enter in any input
  [
    $("newsApiKey"),
    $("geminiApiKey"),
    $("backendUrl"),
    $("writeSecret"),
  ].forEach((inp) => {
    if (inp)
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveKeys();
      });
  });

  // Show/hide write-secret field based on backend URL presence
  $("backendUrl").addEventListener("input", toggleWriteSecretVisibility);
}

/* - Toggle write-secret field visibility - */
function toggleWriteSecretVisibility() {
  const hasUrl = $("backendUrl").value.trim().length > 0;
  $("writeSecretGroup").style.display = hasUrl ? "flex" : "none";
  // writeSecretGroup uses flex-direction:column from .field-group
  if (hasUrl) $("writeSecretGroup").style.flexDirection = "column";
}

/* - Message helper - */
function showMsg(text, type = "success") {
  const box = $("msgBox");
  const span = $("msgText");
  box.className = `msg-box ${type}`;
  span.textContent = text;
  box.style.display = "block";

  if (type === "success") {
    setTimeout(() => {
      box.style.display = "none";
    }, 3500);
  }
}

document.addEventListener("DOMContentLoaded", init);
