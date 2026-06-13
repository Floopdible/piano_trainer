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

    this._mode = 'standard';
    this._currentNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;
    this._minConfidence = 0.85;
    this._holdFrames = 4;
    this._releaseFrames = 6;

    // Noise cancellation
    this._noiseCancel = 'spectral';
    this._monitorEnabled = false;
    this._dfReady = false;
    this._denoiser = null;

    // Multi-note spectral detection (PitchPlease algorithm)
    this._multiNotes = new Map();
    this._spectralAnalyser = null;
    this._spectralRaw = null;
    this._spectralBinMidi = null;
    this._noiseFloor = 0;

    // Basic Pitch
    this._bpModel = null;
    this._bpPredict = null;
    this._bpBuffer = [];
    this._bpProcessing = false;
    this._bpReady = false;
    this._bpActiveNoteSet = new Set();

    // Transkun (ONNX transformer model)
    this._tkSession = null;
    this._tkConfig = null;
    this._tkBuffer = [];
    this._tkProcessing = false;
    this._tkReady = false;
    this._tkAllNotes = [];
    this._tkPrevTime = 0;

    // Kong/Bytedance (ONNX CRNN model)
    this._kSession = null;
    this._kConfig = null;
    this._kBuffer = [];
    this._kProcessing = false;
    this._kReady = false;
    this._kOrt = null;
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

      // Load DeepFilterNet3 noise suppression
      try {
        const DF = (await import('https://esm.sh/deepfilternet3-noise-filter')).DeepFilterNet3Core;
        const base = window.location.origin + '/models/deepfilternet3';
        this._df = new DF({ sampleRate: this._audioCtx.sampleRate, noiseReductionLevel: 40, assetConfig: { cdnUrl: base } });
        await this._df.initialize();
        this._dfNode = await this._df.createAudioWorkletNode(this._audioCtx);
      } catch (e) {
        console.warn('DeepFilterNet3 not available:', e.message);
        this._dfNode = null;
      }

      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0;

      // Load AudioDenoiser (spectral subtraction)
      try {
        this._denoiser = new SpectralSubtractor({ sampleRate: this._audioCtx.sampleRate, fftSize: 2048 });
      } catch (e) { console.warn('SpectralSubtractor unavailable:', e.message); }

      if (this._dfNode) {
        source.connect(this._dfNode);
        this._dfNode.connect(this._analyser);
      } else {
        source.connect(this._analyser);
      }

      // Spectral analyser (max FFT for multi-note detection)
      this._spectralAnalyser = this._audioCtx.createAnalyser();
      this._spectralAnalyser.fftSize = 32768;
      this._spectralAnalyser.smoothingTimeConstant = 0;
      this._spectralAnalyser.minDecibels = -80;
      if (this._dfNode) {
        this._dfNode.connect(this._spectralAnalyser);
      } else {
        source.connect(this._spectralAnalyser);
      }
      const specBinCount = this._spectralAnalyser.frequencyBinCount;
      this._spectralRaw = new Uint8Array(specBinCount);
      const hzPerBin = this._audioCtx.sampleRate / 32768;
      // Cover full piano range (A0=27.5Hz at bin 20 to C8=4186Hz at bin ~3100)
      const binCount = Math.min(specBinCount, 3200);
      this._spectralBinMidi = new Float32Array(binCount);
      for (let i = 0; i < binCount; i++) {
        this._spectralBinMidi[i] = 12 * Math.log(i * hzPerBin / 8.1757989156) / Math.LN2;
      }

      const inputLength = this._analyser.fftSize;
      this._buffer = new Float32Array(inputLength);

      if (this._mode === 'basic-pitch') {
        await this._loadBasicPitch().catch(e => {
          console.warn('Basic Pitch unavailable, falling back to standard:', e.message);
          this._mode = 'standard';
        });
      }
      if (this._mode === 'standard') {
        const mod = await import('https://esm.sh/pitchy@4');
        this._pitchy = mod;
        this._detector = this._pitchy.PitchDetector.forFloat32Array(inputLength);
        // Preload Basic Pitch in background for multi-note supplement
        this._loadBasicPitch().catch(() => {});
      }

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

  async setMode(mode) {
    if (mode !== 'standard' && mode !== 'basic-pitch' && mode !== 'transkun' && mode !== 'transkun-v2' && mode !== 'kong') return;
    this._mode = mode;
    if (this._isRunning) {
      this._rafId && cancelAnimationFrame(this._rafId);
      if (this._mode === 'basic-pitch' && !this._bpReady) {
        try { await this._loadBasicPitch(); } catch (e) { this._mode = 'standard'; }
      }
      if (this._mode === 'transkun') {
        try { await this._loadTranskun(); } catch (e) { console.warn('Transkun unavailable:', e.message); this._mode = 'standard'; }
      }
      if (this._mode === 'transkun-v2') {
        try { await this._loadTranskun('v2'); } catch (e) { console.warn('Transkun V2 unavailable:', e.message); this._mode = 'standard'; }
      }
      if (this._mode === 'kong') {
        try { await this._loadKong(); } catch (e) { console.warn('Kong unavailable:', e.message); this._mode = 'standard'; }
      }
      if (this._mode === 'standard' && !this._pitchy) {
        const mod = await import('https://esm.sh/pitchy@4');
        this._pitchy = mod;
        this._detector = this._pitchy.PitchDetector.forFloat32Array(this._buffer.length);
      }
      this._rafId = requestAnimationFrame(() => this._loop());
    }
  }

  async _loadBasicPitch() {
    try {
      const [tf, bp] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.21.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm')
      ]);
      this._bpPredict = async (audio, model, hopSize) => {
        // Adapt new BasicPitch API to old predict interface
        const instance = new bp.BasicPitch(model);
        const sr = 22050;
        const frameResults = [];
        await instance.evaluateModel(audio, (frames, onsets, contours) => {
          frameResults.push({ noteActivations: frames, onsets, contours });
        }, () => {});
        // Combine all frames into single result
        if (frameResults.length === 0) return { noteActivations: [], onsets: [], contours: [] };
        return {
          noteActivations: frameResults.reduce((a, f) => a.concat(f.noteActivations), []),
          onsets: frameResults.reduce((a, f) => a.concat(f.onsets), []),
          contours: frameResults.reduce((a, f) => a.concat(f.contours), [])
        };
      };

      const modelUrl = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';
      this._bpModel = await Promise.race([
        tf.loadGraphModel(modelUrl),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Basic Pitch model load timeout (30s)')), 30000))
      ]);

      this._bpBuffer = [];
      this._bpProcessing = false;
      this._bpActiveNoteSet = new Set();
      this._bpReady = true;
    } catch (e) {
      console.warn('Basic Pitch unavailable:', e.message);
    }
  }

  stop() {
    this._isRunning = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._cleanup();
    this.activeNotes.clear();
    this.detectedNotes = [];
    this._multiNotes.clear();
    this._bpActiveNoteSet.clear();
    this._bpBuffer = [];
    this._currentNote = -1;
    this._noteFrames = 0;
    this._silentFrames = 0;
    this._noiseFloor = 0;
  }

  _cleanup() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._df) { try { this._df.destroy(); } catch (e) {} this._df = null; }
    this._dfNode = null;
    this._analyser = null;
    this._spectralAnalyser = null;
    this._spectralRaw = null;
    this._detector = null;
    this._buffer = null;
    this._denoiser = null;
    this._bpModel = null;
    this._bpReady = false;
    this._bpProcessing = false;
    // Close AudioContext last, after all nodes are released
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      this._audioCtx.close();
      this._audioCtx = null;
    }
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

  // Calibration
  calibrate(freq) {
    // Single A4 measurement: compute cents offset from A4=440
    const cents = 1200 * Math.log2(freq / 440);
    this._calMap = new Map();
    this._calA4Cents = cents;
    // Apply uniform offset to all 88 notes
    for (let n = 21; n <= 108; n++) {
      this._calMap.set(n, cents);
    }
  }

  isCalibrated() {
    return !!this._calMap;
  }

  setNoiseCancel(mode) {
    this._noiseCancel = mode;
    if (this._isRunning && mode === 'deepfilternet3' && !this._df && !this._dfReady) {
      this._loadDeepFilterNet3().catch(() => {
        console.warn('DeepFilterNet3 unavailable, falling back');
        this._noiseCancel = 'spectral';
      });
    }
  }

  async _loadDeepFilterNet3() {
    try {
      this._dfReady = true;
      const DF = await Promise.race([
        (await import('https://esm.sh/deepfilternet3-noise-filter')).DeepFilterNet3Core,
        new Promise((_, rej) => setTimeout(() => rej(new Error('DeepFilterNet3 load timeout (10s)')), 10000))
      ]);
      const base = window.location.origin + '/models/deepfilternet3';
      this._df = new DF({ sampleRate: this._audioCtx.sampleRate, noiseReductionLevel: 40, assetConfig: { cdnUrl: base } });
      await this._df.initialize();
      const src = this._audioCtx.createMediaStreamSource(this._stream);
      this._dfNode = await this._df.createAudioWorkletNode(this._audioCtx);
      src.connect(this._dfNode);
      this._dfNode.connect(this._analyser);
    } catch (e) {
      console.warn('DeepFilterNet3 unavailable:', e.message);
      this._df = null;
      this._dfReady = false;
    }
  }

  _applyCalibration(freq) {
    if (!this._calMap) return freq;
    const noteNum = Math.round(69 + 12 * Math.log2(freq / 440));
    const offset = this._calMap.get(noteNum);
    return offset ? freq * Math.pow(2, -offset / 1200) : freq;
  }

  _calibratedFreq(noteNum) {
    const base = 440 * Math.pow(2, (noteNum - 69) / 12);
    if (!this._calMap) return base;
    const cents = this._calMap.get(noteNum);
    return cents ? base * Math.pow(2, cents / 1200) : base;
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
      if (this._silentFrames > this._releaseFrames && this._multiNotes.size > 0) {
        for (const [n] of this._multiNotes) {
          this._noteOff(n);
        }
        this._multiNotes.clear();
      }
      if (this.onNotesDetected) this.onNotesDetected([]);
      this._rafId = requestAnimationFrame(() => this._loop());
      return;
    }
    this._silentFrames = 0;

    // Apply noise cancellation before pitch detection
    if (this._noiseCancel === 'spectral' && this._denoiser) {
      try {
        const result = this._denoiser.processFrame(this._buffer);
        if (result && result.audio) this._buffer.set(result.audio);
      } catch (e) {}
    }

    // Basic Pitch: always accumulate buffer
    if (this._bpReady && this._bpModel) {
      this._runBasicPitch();
    }
    // Transkun: accumulate audio for segment processing
    if (this._tkReady) {
      this._runTranskun();
    }
    // Kong: accumulate audio for segment processing
    if (this._kReady) {
      this._runKong();
    }
    if (this._mode === 'basic-pitch') {
    } else if (this._mode === 'transkun') {
    } else if (this._mode === 'kong') {
    } else {
      this._detectPitchy();
    }

    // Multi-note supplement: use Basic Pitch if loaded, fall back to spectral DSP
    let spectralNotes = [];
    if (this._bpReady && this._bpActiveNoteSet.size > 0 && this._mode === 'standard') {
      // Use Basic Pitch results for multi-note supplement
      spectralNotes = Array.from(this._bpActiveNoteSet).map(n => ({
        noteNumber: n,
        noteName: midiToNoteName(n),
        confidence: 0.7,
        frequency: this._calibratedFreq(n)
      }));
    } else if (this._mode === 'standard') {
      // Fall back to spectral DSP when BP not ready
      spectralNotes = this._detectSpectral();
    }
    this._trackMultiNotes(spectralNotes);

    // Merge primary + spectral, deduplicate
    const primary = this.detectedNotes[0];
    const seen = new Set();
    if (primary) seen.add(primary.noteNumber);
    for (const sn of spectralNotes) {
      if (!seen.has(sn.noteNumber)) {
        seen.add(sn.noteNumber);
        this.detectedNotes.push(sn);
      }
    }
    if (this.onNotesDetected) this.onNotesDetected(this.detectedNotes);

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _runBasicPitch() {
    // Accumulate audio samples for Basic Pitch
    for (let i = 0; i < this._buffer.length; i++) {
      this._bpBuffer.push(this._buffer[i]);
    }

    const targetLen = this._audioCtx.sampleRate * 2; // 2 seconds
    if (this._bpBuffer.length >= targetLen && !this._bpProcessing && this._bpReady && this._bpModel) {
      this._processBasicPitch();
    }

    // Apply last BP result as current detected notes
    // (BP updates detectedNotes when inference completes)
  }

  async _processBasicPitch() {
    this._bpProcessing = true;
    try {
      const sr = this._audioCtx.sampleRate;
      // Take the latest 1s of audio
      const sliceLen = sr;
      const slice = this._bpBuffer.slice(-sliceLen);
      // Keep 0.5s overlap for next round
      this._bpBuffer = this._bpBuffer.slice(-Math.floor(sr / 2));

      // Resample from native rate to 22050 Hz (Basic Pitch expects mono 22050)
      const resampled = this._resampleAudio(slice, sr, 22050);

      // Run inference
      const result = await this._bpPredict(resampled, this._bpModel, 256);

      // Post-process: extract active notes using Onsets-and-Frames trick
      // Key insight (BShakhovsky/PianoTranscription_Android + Hawthorne 2018):
      //   For each time step, take element-wise max(frames, onsets)
      //   This boosts frame activations at note onsets, preventing
      //   sustained notes from disappearing as their frame value decays.
      //   Then take max over a short recent window (5 frames ≈ 58ms at 22050Hz)
      //   for low-latency stable detection.
      let activeNotes = [];
      if (result && result.noteActivations && result.onsets) {
        const frames = result.noteActivations;
        const onsets = result.onsets;
        const WINDOW = 5;
        const startFrame = Math.max(0, frames.length - WINDOW);
        for (let p = 0; p < 88; p++) {
          let maxVal = 0;
          for (let t = startFrame; t < frames.length; t++) {
            const fVal = frames[t] && frames[t][p] || 0;
            const oVal = onsets[t] && onsets[t][p] || 0;
            const combined = fVal > oVal ? fVal : oVal;
            if (combined > maxVal) maxVal = combined;
          }
          if (maxVal >= 0.3) {
            const midiNote = p + 21; // Basic Pitch output: 0 = A0 = MIDI 21
            activeNotes.push(midiNote);
          }
        }
      }

      // Compare with previous active set, fire on/off events
      const prevSet = this._bpActiveNoteSet;
      const newSet = new Set(activeNotes);

      // Notes that turned on
      for (const n of newSet) {
        if (!prevSet.has(n)) {
          this._noteOn(n, 0.7);
        }
      }
      // Notes that turned off
      for (const n of prevSet) {
        if (!newSet.has(n)) {
          this._noteOff(n);
        }
      }

      this._bpActiveNoteSet = newSet;

      // Update detectedNotes with BP results
      if (activeNotes.length > 0) {
        this.detectedNotes = activeNotes.map(n => ({
          noteNumber: n,
          noteName: midiToNoteName(n),
          confidence: 0.7,
          frequency: this._calibratedFreq(n)
        }));
      }
    } catch (e) {
      console.warn('Basic Pitch inference failed:', e);
    }
    this._bpProcessing = false;
  }

  _resampleAudio(samples, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const outLen = Math.floor(samples.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      out[i] = idx + 1 < samples.length
        ? samples[idx] * (1 - frac) + samples[idx + 1] * frac
        : samples[idx];
    }
    return out;
  }

  async _loadTranskun(version) {
    version = version || 'v1';
    const ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.min.mjs');
    const configUrl = version === 'v2' ? '/models/transkun_v2_config.json' : '/models/transkun_config.json';
    const modelUrl  = version === 'v2' ? '/models/transkun_v2.onnx'       : '/models/transkun.onnx';
    const configResp = await fetch(configUrl);
    this._tkConfig = await configResp.json();
    this._tkSession = await ort.InferenceSession.create(modelUrl);
    this._tkOrt = ort;
    this._tkBuffer = [];
    this._tkAllNotes = [];
    this._tkProcessing = false;
    this._tkReady = true;
    this._tkVersion = version;
    this._tkInputName  = version === 'v2' ? 'audio'           : 'audio_frames';
    this._tkScoreName  = version === 'v2' ? 'score'           : 'score_matrices';
    this._tkNoiseName  = version === 'v2' ? 'noise'           : 'context_features';
    this._tkDecoder = new TranskunDecoder(this._tkConfig);
  }

  _runTranskun() {
    // Accumulate audio samples at model's sample rate (44100)
    const sr = this._audioCtx.sampleRate;
    const fs = this._tkConfig.fs;
    // Resample buffer to model fs if needed
    for (let i = 0; i < this._buffer.length; i++) {
      this._tkBuffer.push(this._buffer[i]);
    }

    const segSamples = this._tkConfig.segmentSizeInSecond * fs;
    if (this._tkBuffer.length >= segSamples && !this._tkProcessing) {
      this._processTranskunSegment();
    }

    // Show latest transcribed notes
    const currentTime = performance.now() / 1000;
    const activeNow = this._tkAllNotes.filter(n =>
      n.startTime <= currentTime && n.endTime >= currentTime
    );
    if (activeNow.length > 0) {
      this.detectedNotes = activeNow.map(n => ({
        noteNumber: n.pitch,
        noteName: midiToNoteName(n.pitch),
        confidence: 0.9,
        frequency: this._calibratedFreq(n.pitch)
      }));
    }
  }

  async _processTranskunSegment() {
    this._tkProcessing = true;
    try {
      const fs = this._tkConfig.fs;
      const segSamples = this._tkConfig.segmentSizeInSecond * fs;
      const hopSamples = this._tkConfig.segmentHopSizeInSecond * fs;

      // Take latest segment-sized chunk
      const slice = this._tkBuffer.slice(-segSamples);
      // Keep hop-sized overlap for next segment
      this._tkBuffer = this._tkBuffer.slice(-Math.min(hopSamples, this._tkBuffer.length));

      // Resample to 44100 if needed
      const sr = this._audioCtx.sampleRate;
      let audio;
      if (sr !== fs) {
        audio = this._resampleAudio(new Float32Array(slice), sr, fs);
      } else {
        audio = new Float32Array(slice);
      }

      // Normalize gain (same as processFramesBatch)
      let sum = 0;
      for (let i = 0; i < audio.length; i++) sum += audio[i];
      const mean = sum / audio.length;
      let sqSum = 0;
      for (let i = 0; i < audio.length; i++) sqSum += (audio[i] - mean) ** 2;
      const std = Math.sqrt(sqSum / audio.length);
      for (let i = 0; i < audio.length; i++) audio[i] = (audio[i] - mean) / (std + 1e-8);

      // Pad to full segment size
      const padLen = segSamples - audio.length;
      let inputAudio;
      if (padLen > 0) {
        inputAudio = new Float32Array(segSamples);
        inputAudio.set(audio);
      } else {
        inputAudio = audio;
      }

      // Run ONNX model
      const inputTensor = new this._tkOrt.Tensor('float32', inputAudio, [1, 1, segSamples]);
      const feeds = { [this._tkInputName]: inputTensor };
      const results = await this._tkSession.run(feeds);
      const scoreMatrices = results[this._tkScoreName].data;
      const noiseScores = results[this._tkNoiseName].data;

      // Decode with Viterbi
      const T = this._tkConfig.segmentSizeInSecond * fs / this._tkConfig.hopSize;
      const score3D = [];
      let idx = 0;
      for (let i = 0; i < T; i++) {
        score3D[i] = [];
        for (let j = 0; j < T; j++) {
          score3D[i][j] = [];
          for (let k = 0; k < this._tkConfig.targetMIDIPitch.length; k++) {
            score3D[i][j][k] = scoreMatrices[idx++] || 0;
          }
        }
      }

      const nFrames = T - 1;
      const noise2D = [];
      idx = 0;
      for (let i = 0; i < nFrames; i++) {
        noise2D[i] = [];
        for (let k = 0; k < this._tkConfig.targetMIDIPitch.length; k++) {
          noise2D[i][k] = noiseScores[idx++] || 0;
        }
      }

      const intervals = this._tkDecoder.decode(score3D, noise2D);
      const segmentTime = (performance.now() / 1000) - (this._tkConfig.segmentSizeInSecond / 2);
      const notes = this._tkDecoder.intervalsToNotes(intervals, segmentTime, 0);

      // Merge with existing notes
      this._tkAllNotes = this._tkDecoder.mergeNotes([...this._tkAllNotes, ...notes]);

      // Fire note on/off events for any notes that just became active
      if (this.onNotesDetected) {
        const activeNow = this._tkAllNotes.filter(n =>
          n.startTime <= performance.now() / 1000 && n.endTime >= performance.now() / 1000
        );
        this.detectedNotes = activeNow.map(n => ({
          noteNumber: n.pitch,
          noteName: midiToNoteName(n.pitch),
          confidence: 0.9,
          frequency: this._calibratedFreq(n.pitch)
        }));
      }
    } catch (e) {
      console.warn('Transkun inference failed:', e);
    }
    this._tkProcessing = false;
  }

  async _loadKong() {
    try {
      this._kOrt = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.min.mjs');
      const configResp = await fetch('/models/kong_config.json');
      this._kConfig = await configResp.json();
      this._kSession = await this._kOrt.InferenceSession.create('/models/kong.onnx');
      this._kBuffer = [];
      this._kProcessing = false;
      this._kReady = true;
    } catch (e) {
      console.warn('Kong model not found. Run: python3 scripts/export_kong_via_trace.py', e.message);
      throw e;
    }
  }

  _runKong() {
    const sr = this._audioCtx.sampleRate;
    const ksr = this._kConfig.sample_rate;
    // Resample and accumulate into buffer
    for (let i = 0; i < this._buffer.length; i++) {
      this._kBuffer.push(this._buffer[i]);
    }
    // Process in 10s segments (matching model's segment_seconds)
    const segSamples = 10 * ksr;
    if (this._kBuffer.length >= segSamples && !this._kProcessing) {
      this._processKongSegment();
    }
    // Show latest active notes
    if (this.detectedNotes.length === 0 && this._mode === 'kong') {
      // No notes yet, show empty
    } else if (this._mode === 'kong' && this.detectedNotes.length > 0) {
      // Keep last detected notes displayed
    }
  }

  async _processKongSegment() {
    this._kProcessing = true;
    try {
      const ksr = this._kConfig.sample_rate;
      const segSamples = 10 * ksr;
      const slice = this._kBuffer.slice(-segSamples);
      this._kBuffer = [];

      // Resample to 16kHz if needed
      const sr = this._audioCtx.sampleRate;
      let audio;
      if (sr !== ksr) {
        audio = this._resampleAudio(new Float32Array(slice), sr, ksr);
      } else {
        audio = new Float32Array(slice);
      }

      // Pad to full segment if needed
      const inputAudio = new Float32Array(segSamples);
      inputAudio.set(audio.subarray(0, Math.min(audio.length, segSamples)));

      // Run ONNX model
      const inputTensor = new this._kOrt.Tensor('float32', inputAudio, [1, segSamples]);
      const results = await this._kSession.run({ audio: inputTensor });
      const frameOutput = results.frame.data;
      const onsetOutput = results.onset.data;

      // Extract active notes from frame output
      const fps = this._kConfig.frames_per_second || 100;
      const frameLen = segSamples / ksr * fps;
      const notesPerFrame = this._kConfig.classes_num || 88;

      // Get the latest frame's activations
      const lastFrameIdx = Math.floor(frameLen) - 1;
      if (lastFrameIdx >= 0) {
        const activeNotes = [];
        for (let p = 0; p < notesPerFrame; p++) {
          const act = frameOutput[lastFrameIdx * notesPerFrame + p];
          if (act >= (this._kConfig.frame_threshold || 0.3)) {
            activeNotes.push(p + 21); // MIDI notes start at 21
          }
        }
        if (activeNotes.length > 0) {
          this.detectedNotes = activeNotes.map(n => ({
            noteNumber: n,
            noteName: midiToNoteName(n),
            confidence: 0.8,
            frequency: this._calibratedFreq(n)
          }));
          if (this.onNotesDetected) this.onNotesDetected(this.detectedNotes);
        }
      }
    } catch (e) {
      console.warn('Kong inference failed:', e);
    }
    this._kProcessing = false;
  }

  _detectPitchy() {
    const [frequency, clarity] = this._detector.findPitch(this._buffer, this._audioCtx.sampleRate);
    const detected = [];
    let noteNumber = -1;

    if (frequency >= 27.5 && frequency <= 4186 && clarity >= this._minConfidence) {
      const freq = this._applyCalibration(frequency);
      noteNumber = Math.round(69 + 12 * Math.log2(freq / 440));
      if (noteNumber >= 21 && noteNumber <= 108) {
        detected.push({ noteNumber, noteName: midiToNoteName(noteNumber), confidence: clarity, frequency });
      }
    }

    this.detectedNotes = detected;
    this._trackNote(noteNumber, clarity);
  }

  _detectSpectral() {
    if (!this._spectralAnalyser || !this._spectralRaw) return [];
    const sr = this._audioCtx.sampleRate;
    const fftSize = 16384;
    const hzPerBin = sr / fftSize;
    const binCount = this._spectralBinMidi.length;

    this._spectralAnalyser.getByteFrequencyData(this._spectralRaw);

    // Find max energy and update noise floor
    let maxE = 0;
    for (let i = 0; i < binCount; i++) {
      if (this._spectralRaw[i] > maxE) maxE = this._spectralRaw[i];
    }
    let sum = 0, cnt = 0;
    for (let i = 0; i < binCount; i += 10) {
      if (this._spectralRaw[i] < maxE * 0.3) { sum += this._spectralRaw[i]; cnt++; }
    }
    this._noiseFloor = this._noiseFloor * 0.95 + (cnt ? sum / cnt : 0) * 0.05;
    const threshold = Math.min(255, this._noiseFloor * 3);
    if (maxE < threshold + 5) return [];

    // Find spectral peaks
    const maxPeaks = 64;
    const peakBins = new Float32Array(maxPeaks);
    const peakEnergies = new Float32Array(maxPeaks);
    let peakCount = 0;

    for (let i = 1; i < binCount - 1 && peakCount < maxPeaks; i++) {
      const cur = this._spectralRaw[i], prev = this._spectralRaw[i - 1], next = this._spectralRaw[i + 1];
      if (cur > threshold && cur > prev && cur > next) {
        const d = 2 * (prev - 2 * cur + next);
        const off = Math.abs(d) > 0.0001 ? Math.max(-0.5, Math.min(0.5, (prev - next) / d)) : 0;
        peakBins[peakCount] = i + off;
        peakEnergies[peakCount] = cur;
        peakCount++;
      }
    }
    if (peakCount === 0) return [];

    // Score each peak by harmonic support
    const peakMidis = new Float32Array(peakCount);
    const scores = new Float32Array(peakCount);
    for (let i = 0; i < peakCount; i++) peakMidis[i] = this._spectralBinMidi[Math.round(peakBins[i])] || 0;

    for (let i = 0; i < peakCount; i++) {
      const m = peakMidis[i];
      if (m < 21 || m > 108) { scores[i] = 0; continue; }
      let s = peakEnergies[i], h = 1;
      for (let n = 2; n <= 6; n++) {
        const exp = m + 12 * Math.log2(n);
        for (let j = 0; j < peakCount; j++) {
          if (j !== i && Math.abs(peakMidis[j] - exp) < 0.5) { s += peakEnergies[j] / n; h++; break; }
        }
      }
      scores[i] = s * Math.sqrt(h);
    }

    let maxS = 0;
    for (let i = 0; i < peakCount; i++) if (scores[i] > maxS) maxS = scores[i];
    if (maxS > 0) for (let i = 0; i < peakCount; i++) scores[i] /= maxS;

    // Iteratively select fundamentals, mask harmonics
    const used = new Uint8Array(peakCount);
    const maxFundamentals = 8;
    const fundMidis = [];
    for (let f = 0; f < maxFundamentals; f++) {
      let bi = -1, bs = 0.3;
      for (let i = 0; i < peakCount; i++) {
        if (!used[i] && scores[i] > bs) { bs = scores[i]; bi = i; }
      }
      if (bi < 0) break;
      const fm = peakMidis[bi];
      const noteNum = Math.round(fm);
      if (noteNum < 21 || noteNum > 108) { used[bi] = 1; continue; }
      fundMidis.push(noteNum);
      used[bi] = 1;
      // Mark harmonics as used
      for (let n = 2; n <= 6; n++) {
        const exp = fm + 12 * Math.log2(n);
        for (let j = 0; j < peakCount; j++) {
          if (Math.abs(peakMidis[j] - exp) < 0.5) used[j] = 1;
        }
      }
    }

    const notes = [];
    for (let i = 0; i < fundMidis.length; i++) {
      const nn = fundMidis[i];
      const freq = this._calibratedFreq(nn);
      const confidence = Math.min(0.8, Math.max(0.3, scores[i] || 0.5));
      notes.push({
        noteNumber: nn,
        noteName: midiToNoteName(nn),
        confidence: Math.round(confidence * 100) / 100,
        frequency: freq
      });
    }
    return notes;
  }

  _trackMultiNotes(spectralNotes) {
    const detectedNums = new Set(spectralNotes.map(n => n.noteNumber));
    const confMap = new Map(spectralNotes.map(n => [n.noteNumber, n.confidence]));

    for (const [noteNum, state] of this._multiNotes) {
      if (detectedNums.has(noteNum)) {
        state.frames = Math.min(state.frames + 1, this._holdFrames + 5);
      } else {
        state.frames = Math.max(state.frames - 1, -this._releaseFrames);
      }
    }

    for (const noteNum of detectedNums) {
      if (!this._multiNotes.has(noteNum) && noteNum !== this._currentNote && !this._bpActiveNoteSet.has(noteNum)) {
        this._multiNotes.set(noteNum, { frames: 1, held: false });
      }
    }

    for (const [noteNum, state] of this._multiNotes) {
      if (!state.held && state.frames >= this._holdFrames) {
        state.held = true;
        this._noteOn(noteNum, confMap.get(noteNum) || 0.3);
      } else if (state.held && state.frames <= -this._releaseFrames) {
        state.held = false;
        this._noteOff(noteNum);
        this._multiNotes.delete(noteNum);
      }
    }
  }

  _trackNote(noteNumber, clarity) {
    if (noteNumber === this._currentNote && noteNumber >= 0) {
      this._noteFrames++;
      if (this._noteFrames >= this._holdFrames && !this.activeNotes.has(noteNumber)) {
        this._noteOn(noteNumber, clarity);
      }
    } else if (noteNumber !== this._currentNote) {
      if (this._currentNote >= 0) this._noteOff(this._currentNote);
      this._currentNote = noteNumber;
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

  getProcessedStream() {
    if (!this._audioCtx || !this._stream) return null;
    const dst = this._audioCtx.createMediaStreamDestination();
    if (this._dfNode) {
      let src = this._audioCtx.createMediaStreamSource(this._stream);
      src.connect(this._dfNode);
      this._dfNode.connect(dst);
    } else {
      const src = this._audioCtx.createMediaStreamSource(this._stream);
      src.connect(dst);
    }
    return dst.stream;
  }
}
