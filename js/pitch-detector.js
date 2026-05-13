class PitchDetector {
  constructor() {
    this._pitchy = null;
    this._detector = null;
    this._audioCtx = null;
    this._analyser = null;
    this._stream = null;
    this._buffer = null;
    this._rafId = null;
    this._isRunning = false;

    this.activeNotes = new Map();
    this.detectedNotes = [];
    this.volumeLevel = 0;
    this.sensitivity = 0.5;

    this.onNoteOn = null;
    this.onNoteOff = null;
    this.onNotesDetected = null;

    this._currentNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;
    this._minConfidence = 0.85;
    this._holdFrames = 4;
    this._releaseFrames = 6;
    this._initialized = false;
  }

  async start() {
    try {
      const mod = await import('https://esm.sh/pitchy@4');
      this._pitchy = mod;

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

      const inputLength = this._analyser.fftSize;
      this._buffer = new Float32Array(inputLength);
      this._detector = this._pitchy.PitchDetector.forFloat32Array(inputLength);

      this._setSensitivity(this.sensitivity);
      this._isRunning = true;
      this._loop();
      return true;
    } catch (err) {
      console.error('Pitch detector start failed:', err);
      this._cleanup();
      return false;
    }
  }

  stop() {
    this._isRunning = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._cleanup();
    this.activeNotes.clear();
    this.detectedNotes = [];
    this._currentNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;
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

  setSensitivity(val) {
    this.sensitivity = Math.max(0, Math.min(1, val));
    this._setSensitivity(this.sensitivity);
  }

  _setSensitivity(val) {
    this._minConfidence = 0.95 - val * 0.2;
    this._holdFrames = Math.round(6 - val * 4);
    this._releaseFrames = Math.round(10 - val * 8);
  }

  _loop() {
    if (!this._isRunning) return;

    this._analyser.getFloatTimeDomainData(this._buffer);

    let rms = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      rms += this._buffer[i] * this._buffer[i];
    }
    rms = Math.sqrt(rms / this._buffer.length);
    this.volumeLevel = Math.min(1, rms * 8);

    if (rms < 0.005) {
      this.detectedNotes = [];
      this._silentFrames++;
      if (this._silentFrames > this._releaseFrames && this._currentNote >= 0) {
        this._noteOff(this._currentNote);
        this._currentNote = -1;
        this._noteFrames = 0;
      }
      this._rafId = requestAnimationFrame(() => this._loop());
      return;
    }
    this._silentFrames = 0;

    const [frequency, clarity] = this._detector.findPitch(this._buffer, this._audioCtx.sampleRate);

    const detected = [];
    let noteNumber = -1;

    if (frequency >= 27.5 && frequency <= 4186 && clarity >= this._minConfidence) {
      noteNumber = Math.round(69 + 12 * Math.log2(frequency / 440));
      if (noteNumber >= 21 && noteNumber <= 108) {
        detected.push({
          noteNumber,
          noteName: midiToNoteName(noteNumber),
          confidence: clarity,
          frequency,
        });
      }
    }

    this.detectedNotes = detected;

    if (noteNumber === this._currentNote && noteNumber >= 0) {
      this._noteFrames++;
      if (this._noteFrames >= this._holdFrames && !this.activeNotes.has(noteNumber)) {
        this._noteOn(noteNumber, clarity);
      }
    } else if (noteNumber !== this._currentNote) {
      if (this._currentNote >= 0) {
        this._noteOff(this._currentNote);
      }
      this._currentNote = noteNumber;
      this._noteFrames = 0;
    }

    if (this.onNotesDetected) this.onNotesDetected(detected);

    this._rafId = requestAnimationFrame(() => this._loop());
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
