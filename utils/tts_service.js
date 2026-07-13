/**
 * tts-service.js
 * Smooth Web Speech API wrapper with:
 *  - Intelligent voice selection (prefers Google/Microsoft neural voices)
 *  - Chunked playback to avoid the Chrome 32KB / 15-second TTS cutoff bug
 *  - Keep-alive timer to prevent Chrome's silent pause bug
 *  - Progress callbacks via charIndex from onboundary events
 */

/** Preferred voice name fragments, ordered by quality */
const FEMALE_PREFS = [
  'Google US English',
  'Microsoft Jenny',
  'Microsoft Aria',
  'Samantha',        // macOS
  'Victoria',        // macOS
  'Karen',           // macOS
  'Microsoft Zira',
  'Google UK English Female',
];

const MALE_PREFS = [
  'Google UK English Male',
  'Microsoft Guy',
  'Microsoft Davis',
  'Daniel',          // macOS
  'Alex',            // macOS
  'Microsoft David',
  'Google US English Male',
];

export class TTSService {
  constructor() {
    this._gender        = 'female';
    this._chunks        = [];
    this._chunkIdx      = 0;
    this._totalLen      = 0;
    this._doneLen       = 0;
    this._playing       = false;
    this._paused        = false;
    this._keepAlive     = null;
    this._currentVoice  = null; // resolved once per speak() — reused across all chunks
    this._overrideVoice = null; // set via setOverrideVoice() when user picks a specific voice

    /** Callbacks — assign from outside */
    this.onStart    = null; // ()
    this.onProgress = null; // (charIndex: number, total: number)
    this.onEnd      = null; // ()
    this.onError    = null; // (errorMsg: string)

    // Pre-load voices (some browsers populate asynchronously)
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.getVoices(); // warm up
      speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
    }
  }

  /* - Public API - */

  get isPlaying() { return this._playing; }
  get isPaused()  { return this._paused;  }

  /**
   * Pin a specific voice to use for the next speak() call.
   * Pass null to fall back to automatic best-voice selection.
   * Must be called BEFORE speak().
   */
  setOverrideVoice(voice) {
    this._overrideVoice = voice || null;
  }

  speak(text, gender = 'female') {
    this.stop();
    this._gender   = gender;
    this._totalLen = text.length;
    this._doneLen  = 0;
    this._chunks   = this._chunkText(text);
    this._chunkIdx = 0;
    this._playing  = true;
    this._paused   = false;

    // Resolve voice ONCE here — reused for all chunks.
    // _overrideVoice takes precedence (user-selected); falls back to best auto-pick.
    this._currentVoice = this._overrideVoice || this.getBestVoice(gender);

    if (this.onStart) this.onStart();
    this._startKeepAlive();
    this._speakChunk(0);
  }

  pause() {
    if (this._playing && !this._paused) {
      speechSynthesis.pause();
      this._paused = true;
    }
  }

  resume() {
    if (this._playing && this._paused) {
      speechSynthesis.resume();
      this._paused = false;
    }
  }

  stop() {
    this._playing      = false;
    this._paused       = false;
    this._currentVoice = null;
    this._stopKeepAlive();
    speechSynthesis.cancel();
  }

  /** Return all available voices, optionally filtered by gender keyword */
  getVoices(gender = null) {
    const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    if (!gender) return voices;

    const hints = gender === 'female' ? FEMALE_PREFS : MALE_PREFS;
    // Put preferred voices first
    return voices.slice().sort((a, b) => {
      const ai = hints.findIndex(h => a.name.includes(h));
      const bi = hints.findIndex(h => b.name.includes(h));
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    });
  }

  /** Pick the best voice for the given gender */
  getBestVoice(gender) {
    const sorted = this.getVoices(gender);
    return sorted[0] || speechSynthesis.getVoices()[0] || null;
  }

  /* - Private helpers - */

  /**
   * Split at sentence boundaries (. ! ?) to avoid Chrome's TTS cutoff.
   * Max chunk ~200 chars keeps things safe.
   */
  _chunkText(text, maxLen = 200) {
    // Match sentences; include trailing punctuation
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const chunks = [];
    let current = '';

    for (const s of sentences) {
      if (current.length + s.length > maxLen && current.length > 0) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  _speakChunk(idx) {
    if (!this._playing || idx >= this._chunks.length) {
      if (this._playing) this._finish();
      return;
    }

    const chunk = this._chunks[idx];
    const utt   = new SpeechSynthesisUtterance(chunk);

    // Use the voice resolved once at speak() time — not re-evaluated per chunk.
    if (this._currentVoice) utt.voice = this._currentVoice;
    utt.rate  = 0.95;
    utt.pitch = 1.0;
    utt.lang  = 'en-US';

    utt.onboundary = (e) => {
      if (this.onProgress) {
        this.onProgress(this._doneLen + e.charIndex, this._totalLen);
      }
    };

    utt.onend = () => {
      this._doneLen += chunk.length + 1; // +1 for the space between chunks
      this._chunkIdx = idx + 1;
      if (this._playing && !this._paused) {
        this._speakChunk(this._chunkIdx);
      }
    };

    utt.onerror = (e) => {
      // 'canceled' / 'interrupted' are expected on stop() — not real errors
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        if (this.onError) this.onError(e.error);
      }
    };

    speechSynthesis.speak(utt);
  }

  _finish() {
    this._playing = false;
    this._stopKeepAlive();
    if (this.onEnd) this.onEnd();
  }

  /**
   * Chrome bug: speechSynthesis silently stops after ~15 s.
   * Fix: pause + resume every 14 s while playing.
   */
  _startKeepAlive() {
    this._keepAlive = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 14_000);
  }

  _stopKeepAlive() {
    if (this._keepAlive) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
  }
}

