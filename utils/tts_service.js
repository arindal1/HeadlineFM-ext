/**
 * tts-service.js
 * Natural-sounding TTS via the Gemini 2.5 Flash TTS API + Web Audio API.
 *
 * Replaces Web Speech API to eliminate the Chrome ~15-second cutoff bug and
 * deliver expressive, broadcast-quality voices.
 *
 * Same public interface as before - popup.js changes are minimal.
 *
 * Audio format returned by Gemini TTS:
 *   raw PCM · 16-bit signed little-endian · 24 kHz · mono
 */

const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent";

const PCM_SAMPLE_RATE = 24_000; // Hz

/** Max chars per API call. A 700-word broadcast ≈ 4 200 chars, well under Gemini's 8 k-token limit. */
const CHUNK_SIZE = 4_000;

/**
 * Fixed broadcast voices - chosen for quality and consistency.
 * Female: Aoede - warm, breezy, natural-sounding.
 * Male:   Charon - deep, firm, authoritative.
 * Fixed voices mean the audio output is deterministic for a given script,
 * which enables reliable local audio caching.
 */
const VOICE = { female: "Aoede", male: "Charon" };

export class TTSService {
  constructor() {
    this._gen = 0; // incremented on every speak() - cancellation token
    this._audioCtx = null;
    this._sourceNode = null;
    this._progressTimer = null;
    this._progressParams = null; // saved for resume()
    this._playing = false;
    this._paused = false;
    this._totalLen = 0;
    this._charOffset = 0;
    this._currentChunkLen = 0;
    this._currentDuration = 0;

    /** Public callbacks - assign from outside */
    this.onStart = null; // ()
    this.onProgress = null; // (charIndex: number, total: number)
    this.onEnd = null; // ()
    this.onError = null; // (errorMsg: string)
  }

  // ── Public API

  get isPlaying() {
    return this._playing;
  }
  get isPaused() {
    return this._paused;
  }

  /**
   * Generate and play audio via Gemini TTS.
   * @param {string} text
   * @param {'female'|'male'} gender
   * @param {string} apiKey  - Gemini API key (required)
   */
  speak(text, gender = "female", apiKey = "") {
    this._cancelAndCleanup();

    if (!apiKey) {
      if (this.onError) this.onError("Gemini API key required for TTS");
      return;
    }

    const gen = ++this._gen;
    const voiceName = VOICE[gender] ?? VOICE.female;

    this._totalLen = text.length;
    this._charOffset = 0;
    this._playing = true;
    this._paused = false;

    if (this.onStart) this.onStart();

    // Fire-and-forget - all errors surface via this.onError
    this._runChunks(
      this._chunkText(text, CHUNK_SIZE),
      voiceName,
      apiKey,
      gen,
    ).catch(() => {});
  }

  pause() {
    if (this._playing && !this._paused && this._audioCtx) {
      this._audioCtx.suspend().catch(() => {});
      this._paused = true;
      this._stopProgressTimer();
    }
  }

  resume() {
    if (this._playing && this._paused && this._audioCtx) {
      this._audioCtx.resume().catch(() => {});
      this._paused = false;
      if (this._progressParams) {
        const { charOffset, chunkLen, duration, ctxStart } =
          this._progressParams;
        this._startProgressTimer(charOffset, chunkLen, duration, ctxStart);
      }
    }
  }

  stop() {
    this._cancelAndCleanup();
  }

  // ── Private

  _cancelAndCleanup() {
    this._gen++;
    this._playing = false;
    this._paused = false;
    this._stopProgressTimer();
    this._destroyAudio();
  }

  _destroyAudio() {
    if (this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch {}
      this._sourceNode.disconnect();
      this._sourceNode = null;
    }
    if (this._audioCtx) {
      try {
        this._audioCtx.close();
      } catch {}
      this._audioCtx = null;
    }
  }

  async _runChunks(chunks, voiceName, apiKey, gen) {
    try {
      // Pipeline: fetch next chunk while current chunk is playing
      let pending = this._fetchAudio(chunks[0], voiceName, apiKey);

      for (let i = 0; i < chunks.length; i++) {
        if (this._gen !== gen) return;

        const audioBuffer = await pending;
        if (this._gen !== gen) return;

        // Pre-fetch the next chunk in parallel with playback
        if (i + 1 < chunks.length) {
          pending = this._fetchAudio(chunks[i + 1], voiceName, apiKey);
        }

        this._currentChunkLen = chunks[i].length;
        this._currentDuration = audioBuffer.duration;

        await this._playBuffer(audioBuffer, gen);
        if (this._gen !== gen) return;

        this._charOffset += chunks[i].length;
      }

      if (this._gen === gen) {
        this._playing = false;
        this._stopProgressTimer();
        if (this.onEnd) this.onEnd();
      }
    } catch (err) {
      if (this._gen === gen) {
        this._playing = false;
        this._stopProgressTimer();
        if (this.onError) this.onError(err.message ?? String(err));
      }
    }
  }

  /** Call Gemini TTS REST endpoint → decoded AudioBuffer */
  async _fetchAudio(text, voiceName, apiKey) {
    const res = await fetch(`${GEMINI_TTS_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }], role: "user" }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `Gemini TTS error ${res.status}`);
    }

    const data = await res.json();
    const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error("Gemini TTS returned no audio data");

    return this._decodePCM(b64);
  }

  /** Decode base64 raw PCM (signed 16-bit LE, 24 kHz, mono) → AudioBuffer */
  _decodePCM(base64) {
    const binaryStr = atob(base64);
    const numSamples = binaryStr.length >> 1; // 2 bytes per sample

    // Lazy-init AudioContext (must be inside a user-gesture call chain)
    if (!this._audioCtx) {
      this._audioCtx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    }

    const buffer = this._audioCtx.createBuffer(1, numSamples, PCM_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const lo = binaryStr.charCodeAt(i * 2);
      const hi = binaryStr.charCodeAt(i * 2 + 1);
      let s = (hi << 8) | lo;
      if (s > 32767) s -= 65536;
      channel[i] = s / 32768;
    }

    return buffer;
  }

  /** Play an AudioBuffer; resolves when playback finishes or is cancelled */
  _playBuffer(audioBuffer, gen) {
    return new Promise((resolve) => {
      if (this._gen !== gen) {
        resolve();
        return;
      }

      const src = this._audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this._audioCtx.destination);
      this._sourceNode = src;

      const ctxStart = this._audioCtx.currentTime;
      this._startProgressTimer(
        this._charOffset,
        this._currentChunkLen,
        audioBuffer.duration,
        ctxStart,
      );

      src.onended = () => {
        this._stopProgressTimer();
        resolve();
      };

      src.start(0);
    });
  }

  _startProgressTimer(charOffset, chunkLen, duration, ctxStart) {
    this._progressParams = { charOffset, chunkLen, duration, ctxStart };
    this._stopProgressTimer();
    this._progressTimer = setInterval(() => {
      if (!this._audioCtx || !this._playing || this._paused) return;
      const elapsed = this._audioCtx.currentTime - ctxStart;
      const ratio = Math.min(elapsed / duration, 1);
      const charIdx = charOffset + Math.floor(ratio * chunkLen);
      if (this.onProgress) this.onProgress(charIdx, this._totalLen);
    }, 100);
  }

  _stopProgressTimer() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }

  /** Split at paragraph boundaries, then sentence endings, within maxLen. */
  _chunkText(text, maxLen) {
    if (text.length <= maxLen) return [text];

    const chunks = [];
    const paragraphs = text.split(/\n{2,}/);
    let current = "";

    for (const para of paragraphs) {
      if (current.length + para.length + 2 > maxLen && current) {
        chunks.push(current.trim());
        current = para;
      } else {
        current += (current ? "\n\n" : "") + para;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }
}
