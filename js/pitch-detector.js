class PitchDetector {
  constructor() {
    this.activeNotes = new Map();
    this.detectedNotes = [];
    this.volumeLevel = 0;
    this.sensitivity = 0.5;

    this.onNoteOn = null;
    this.onNoteOff = null;
    this.onNotesDetected = null;

    this._mode = 'standard';
    this._isRunning = false;
    this._rafId = null;
    this._lastNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;

    // Standard mode (pitchy)
    this._pitchy = null;
    this._detector = null;
    this._audioCtx = null;
    this._analyser = null;
    this._stream = null;
    this._buffer = null;
    this._smoothFreq = 0;

    // ML mode (ml5.js CREPE)
    this._ml5 = null;
    this._pitch = null;
    this._mlPending = false;

    // Thresholds
    this._minConfidence = 0.65;
    this._mlMinConfidence = 0.85;
    this._onsetFrames = 1;
    this._holdFrames = 3;
    this._releaseFrames = 6;
    this._rmsGate = 0.005;
  }

  async start() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        }
      });

      const AC = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AC();
      if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();

      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0;
      source.connect(this._analyser);

      this._buffer = new Float32Array(this._analyser.fftSize);
      this._applySensitivity();
      this._isRunning = true;

      if (this._mode === 'ml') await this._loadML();
      else await this._loadPitchy();

      this._loop();
      return true;
    } catch (err) {
      console.error('Pitch detector start failed:', err);
      this._cleanup();
      return false;
    }
  }

  async setMode(mode) {
    if (mode !== 'standard' && mode !== 'ml') return;
    this._mode = mode;
    if (this._isRunning) {
      this._rafId && cancelAnimationFrame(this._rafId);
      if (this._mode === 'ml' && !this._ml5) {
        try { await this._loadML(); } catch (e) { this._mode = 'standard'; }
      }
      if (this._mode === 'standard' && !this._pitchy) {
        await this._loadPitchy();
      }
      this._rafId = requestAnimationFrame(() => this._loop());
    }
  }

  async _loadPitchy() {
    const mod = await import('https://esm.sh/pitchy@4');
    this._pitchy = mod;
    this._detector = this._pitchy.PitchDetector.forFloat32Array(this._buffer.length);
  }

  async _loadML() {
    await new Promise((resolve, reject) => {
      if (window.ml5) return resolve();
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/ml5@1/dist/ml5.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    this._ml5 = window.ml5;
    const modelURLs = [
      'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/pitch-detection/crepe/',
      'https://storage.googleapis.com/tfjs-models/savedmodel/crepe/',
      'https://huggingface.co/tensorflowjs/converted/tfjs_model_from_tf_crepe/resolve/main/',
    ];
    let lastErr;
    for (const url of modelURLs) {
      try {
        this._pitch = await this._ml5.pitchDetection(url);
        return;
      } catch (e) { lastErr = e; }
    }
    throw new Error('Failed to load CREPE model from all CDNs: ' + lastErr.message);
  }

  stop() {
    this._isRunning = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._cleanup();
    this.activeNotes.clear();
    this.detectedNotes = [];
    this._lastNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;
    this._smoothFreq = 0;
    this._mlPending = false;
  }

  _cleanup() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._analyser = null;
    this._detector = null;
    this._buffer = null;
  }

  setClarity(val) {
    this._minConfidence = 0.85 - Math.max(0, Math.min(1, val)) * 0.60;
  }

  setSpeed(val) {
    this._holdFrames = Math.round(5 - Math.max(0, Math.min(1, val)) * 3);
  }

  setRelease(val) {
    this._releaseFrames = Math.round(14 - Math.max(0, Math.min(1, val)) * 11);
  }

  setSensitivity(val) {
    this.sensitivity = Math.max(0, Math.min(1, val));
    this._applySensitivity();
  }

  _applySensitivity() {
    const s = this.sensitivity;
    this._minConfidence = 0.85 - s * 0.45;
    this._mlMinConfidence = 0.95 - s * 0.25;
    this._onsetFrames = Math.round(3 - s * 2);
    this._holdFrames = Math.round(5 - s * 3);
    this._releaseFrames = Math.round(14 - s * 11);
    this._rmsGate = 0.010 - s * 0.008;
  }

  _loop() {
    if (!this._isRunning) return;

    this._analyser.getFloatTimeDomainData(this._buffer);

    let rms = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      rms += this._buffer[i] * this._buffer[i];
    }
    rms = Math.sqrt(rms / this._buffer.length);
    this.volumeLevel = Math.min(1, rms * 5);

    if (rms < this._rmsGate) {
      this.detectedNotes = [];
      this._silentFrames++;
      if (this._silentFrames > this._releaseFrames && this._lastNote >= 0) {
        this._noteOff(this._lastNote);
        this._lastNote = -1;
        this._noteFrames = 0;
        this._mlPending = false;
      }
      this._rafId = requestAnimationFrame(() => this._loop());
      return;
    }
    this._silentFrames = 0;

    if (this._mode === 'ml' && this._pitch) {
      if (!this._mlPending) this._detectML();
    } else if (this._detector) {
      this._detectPitchy();
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _detectPitchy() {
    const [frequency, clarity] = this._detector.findPitch(this._buffer, this._audioCtx.sampleRate);
    const detected = [];
    let noteNumber = -1;

    if (frequency >= 27.5 && frequency <= 4186 && clarity >= this._minConfidence) {
      this._smoothFreq = this._smoothFreq ? this._smoothFreq * 0.6 + frequency * 0.4 : frequency;
      noteNumber = Math.round(69 + 12 * Math.log2(this._smoothFreq / 440));
      if (noteNumber >= 21 && noteNumber <= 108) {
        detected.push({
          noteNumber,
          noteName: midiToNoteName(noteNumber),
          confidence: clarity,
          frequency: this._smoothFreq,
        });
      }
    }

    this.detectedNotes = detected;
    this._trackNote(noteNumber, clarity);
    if (this.onNotesDetected) this.onNotesDetected(detected);
  }

  _detectML() {
    this._mlPending = true;
    this._pitch.getPitch(this._audioCtx, this._stream, (err, frequency) => {
      this._mlPending = false;
      if (err) return;

      const detected = [];
      let noteNumber = -1;

      if (frequency && frequency >= 27.5 && frequency <= 4186) {
        const conf = Math.min(1, Math.max(0, (frequency % 1) * 0.5 + 0.5));
        if (conf >= this._mlMinConfidence) {
          this._smoothFreq = this._smoothFreq ? this._smoothFreq * 0.6 + frequency * 0.4 : frequency;
          noteNumber = Math.round(69 + 12 * Math.log2(this._smoothFreq / 440));
          if (noteNumber >= 21 && noteNumber <= 108) {
            detected.push({
              noteNumber,
              noteName: midiToNoteName(noteNumber),
              confidence: conf,
              frequency: this._smoothFreq,
            });
          }
        }
      }

      this.detectedNotes = detected;
      this._trackNote(noteNumber, 0.9);
      if (this.onNotesDetected) this.onNotesDetected(detected);
    });
  }

  _trackNote(noteNumber, clarity) {
    const hasActive = this._lastNote >= 0 && this.activeNotes.has(this._lastNote);

    if (hasActive) {
      if (noteNumber >= 0 && noteNumber !== this._lastNote) {
        this._noteFrames++;
        if (this._noteFrames >= this._holdFrames) {
          this._noteOff(this._lastNote);
          this._lastNote = noteNumber;
          this._noteFrames = 0;
          this._noteOn(noteNumber, clarity);
        }
      } else {
        this._noteFrames = 0;
      }
      return;
    }

    if (noteNumber === this._lastNote && noteNumber >= 0) {
      this._noteFrames++;
      if (this._noteFrames >= this._onsetFrames) {
        this._noteOn(noteNumber, clarity);
      }
    } else if (noteNumber !== this._lastNote) {
      this._lastNote = noteNumber;
      this._noteFrames = 0;
    }
  }

  _noteOn(noteNum, confidence) {
    this.activeNotes.set(noteNum, { startTime: performance.now(), confidence });
    if (this.onNoteOn) this.onNoteOn(noteNum, confidence);
  }

  _noteOff(noteNum) {
    this.activeNotes.delete(noteNum);
    if (this.onNoteOff) this.onNoteOff(noteNum);
  }

  getActiveNotes() {
    return Array.from(this.activeNotes.keys());
  }
}
