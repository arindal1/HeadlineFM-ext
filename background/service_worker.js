/**
 * service-worker.js — HeadlineFM background service worker (MV3)
 * Minimal: just keeps the extension alive and handles
 * the options page shortcut for the context menu.
 */

// Open options page when extension is first installed
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});
