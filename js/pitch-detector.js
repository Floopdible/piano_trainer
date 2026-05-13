/**
 * Pitch Detector
 * Uses Web Audio API + FFT spectral analysis for polyphonic piano note detection
 * Combines autocorrelation and harmonic peak analysis
 */
class PitchDetector {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.isListening = false;
    this.sampleRate = 44100;
    this.fftSize = 8192;
    this.minNote = 21;  // A0 = 27.5 Hz
    this.maxNote = 108; // C8 = 4186 Hz
    this.minFreq = midiToFrequency(this.minNote);
    this.maxFreq = midiToFrequency(this.maxNote);
    this.noiseFloor = -65;
    this.peakThresholdDb = 25;
    this.activeNotes = new Map();
    this.noteOnHold = new Map(); // Debounce: noteNum -> { count, last }
    this.holdFrames = 2;
    this.releaseFrames = 3;
    this.detectedNotes = [];
    this.onNoteOn = null;
    this.onNoteOff = null;
    this.onNotesDetected = null;
    this._animFrame = null;
    this.sensitivity = 0.5; // 0-1
    this.volumeLevel = 0;
  }

  async start() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });

      const source = this.audioContext.createMediaStreamSource(this.stream);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.2;
      this.analyser.minDecibels = -100;
      this.analyser.maxDecibels = -10;

      source.connect(this.analyser);

      this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      this.timeDomainData = new Float32Array(this.fftSize);

      this.isListening = true;
      this._detect();
      return true;
    } catch (err) {
      console.error('Mic access failed:', err);
      return false;
    }
  }

  stop() {
    this.isListening = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.activeNotes.clear();
    this.noteOnHold.clear();
    this.detectedNotes = [];
  }

  setSensitivity(val) {
    this.sensitivity = Math.max(0, Math.min(1, val));
    this.noiseFloor = -50 - this.sensitivity * 30; // -50 to -80
    this.peakThresholdDb = 35 - this.sensitivity * 20; // 35 to 15
  }

  _detect() {
    if (!this.isListening) return;

    this.analyser.getFloatFrequencyData(this.frequencyData);
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    // Calculate volume level (RMS)
    let rms = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      rms += this.timeDomainData[i] * this.timeDomainData[i];
    }
    rms = Math.sqrt(rms / this.timeDomainData.length);
    this.volumeLevel = Math.min(1, rms * 10);

    const detected = this._detectNotes();
    const currentNotes = new Set(detected.map(n => n.noteNumber));

    // Update hold counters for detected notes
    for (const note of detected) {
      const hold = this.noteOnHold.get(note.noteNumber);
      if (hold) {
        hold.count = Math.min(hold.count + 1, this.holdFrames + 5);
        hold.confidence = Math.max(hold.confidence, note.confidence);
      } else {
        this.noteOnHold.set(note.noteNumber, {
          count: 1,
          confidence: note.confidence
        });
      }
    }

    // Decrement hold for notes no longer detected
    for (const [noteNum, hold] of this.noteOnHold) {
      if (!currentNotes.has(noteNum)) {
        hold.count--;
        if (hold.count <= 0) {
          this.noteOnHold.delete(noteNum);
        }
      }
    }

    // Fire note on events (after holdFrames of consecutive detection)
    for (const [noteNum, hold] of this.noteOnHold) {
      if (hold.count >= this.holdFrames && !this.activeNotes.has(noteNum)) {
        this.activeNotes.set(noteNum, {
          startTime: performance.now(),
          confidence: hold.confidence
        });
        if (this.onNoteOn) this.onNoteOn(noteNum, hold.confidence);
      }
    }

    // Fire note off events
    for (const [noteNum] of this.activeNotes) {
      if (!this.noteOnHold.has(noteNum)) {
        this.activeNotes.delete(noteNum);
        if (this.onNoteOff) this.onNoteOff(noteNum);
      }
    }

    this.detectedNotes = detected;
    if (this.onNotesDetected) this.onNotesDetected(detected);

    this._animFrame = requestAnimationFrame(() => this._detect());
  }

  _detectNotes() {
    const notes = [];
    const binSize = this.sampleRate / this.fftSize;
    const minBin = Math.max(1, Math.floor(this.minFreq / binSize));
    const maxBin = Math.min(
      Math.ceil(this.maxFreq / binSize),
      this.frequencyData.length - 2
    );

    // Find max level
    let maxLevel = -Infinity;
    for (let i = minBin; i <= maxBin; i++) {
      if (this.frequencyData[i] > maxLevel) maxLevel = this.frequencyData[i];
    }

    if (maxLevel < this.noiseFloor) return notes;

    const threshold = maxLevel - this.peakThresholdDb;

    // Find spectral peaks
    const peaks = [];
    for (let i = minBin + 1; i < maxBin; i++) {
      const val = this.frequencyData[i];
      if (val > threshold &&
          val > this.frequencyData[i - 1] &&
          val > this.frequencyData[i + 1] &&
          val - this.frequencyData[Math.max(0, i - 3)] > 3 &&
          val - this.frequencyData[Math.min(this.frequencyData.length - 1, i + 3)] > 3) {
        // Parabolic interpolation
        const alpha = this.frequencyData[i - 1];
        const beta = this.frequencyData[i];
        const gamma = this.frequencyData[i + 1];
        const denom = alpha - 2 * beta + gamma;
        const p = denom !== 0 ? 0.5 * (alpha - gamma) / denom : 0;
        const freq = (i + p) * binSize;
        const amplitude = beta - 0.25 * (alpha - gamma) * p;

        if (freq >= this.minFreq && freq <= this.maxFreq) {
          peaks.push({ freq, amplitude, bin: i });
        }
      }
    }

    peaks.sort((a, b) => b.amplitude - a.amplitude);

    // Identify fundamentals by checking for harmonic series
    const fundamentals = [];
    const usedPeaks = new Set();

    for (let pi = 0; pi < peaks.length && fundamentals.length < 8; pi++) {
      const peak = peaks[pi];
      if (usedPeaks.has(pi)) continue;

      const midiNote = frequencyToMidi(peak.freq);
      if (midiNote < this.minNote || midiNote > this.maxNote) continue;

      // Check if this is a harmonic of an existing fundamental
      let isHarmonic = false;
      for (const fund of fundamentals) {
        const ratio = peak.freq / fund.freq;
        const nearestH = Math.round(ratio);
        if (nearestH >= 2 && nearestH <= 10) {
          const deviation = Math.abs(ratio - nearestH) / nearestH;
          if (deviation < 0.025) {
            isHarmonic = true;
            fund.harmonicEnergy += peak.amplitude;
            usedPeaks.add(pi);
            break;
          }
        }
      }

      if (isHarmonic) continue;

      // Count harmonics for this candidate fundamental
      let harmonicCount = 0;
      let harmonicEnergy = 0;
      for (let oi = 0; oi < peaks.length; oi++) {
        if (oi === pi) continue;
        const ratio = peaks[oi].freq / peak.freq;
        const nearestH = Math.round(ratio);
        if (nearestH >= 2 && nearestH <= 10) {
          const deviation = Math.abs(ratio - nearestH) / nearestH;
          if (deviation < 0.025) {
            harmonicCount++;
            harmonicEnergy += peaks[oi].amplitude;
            usedPeaks.add(oi);
          }
        }
      }

      // Also check if this peak might be a sub-harmonic
      // (i.e., the actual fundamental is at half this frequency)
      let isMissedSubHarmonic = false;
      const subFreq = peak.freq / 2;
      if (subFreq >= this.minFreq) {
        const subBin = Math.round(subFreq / binSize);
        if (subBin >= minBin && subBin <= maxBin) {
          const subLevel = this.frequencyData[subBin];
          // If there's significant energy at the sub-harmonic, this might be the 2nd harmonic
          if (subLevel > threshold - 5) {
            // Don't skip, but note it
          }
        }
      }

      const confidence = Math.min(1,
        0.3 +
        (peak.amplitude - threshold) / Math.max(1, maxLevel - threshold) * 0.4 +
        harmonicCount * 0.1
      );

      if (confidence > 0.25 || harmonicCount >= 2) {
        fundamentals.push({
          freq: peak.freq,
          noteNumber: midiNote,
          noteName: midiToNoteName(midiNote),
          confidence,
          amplitude: peak.amplitude,
          harmonicCount,
          harmonicEnergy
        });
        usedPeaks.add(pi);
      }
    }

    // Also try autocorrelation for strongest pitch confirmation
    const autoPitch = this._autocorrelation();
    if (autoPitch > 0) {
      const autoMidi = frequencyToMidi(autoPitch);
      if (autoMidi >= this.minNote && autoMidi <= this.maxNote) {
        const existing = fundamentals.find(f => f.noteNumber === autoMidi);
        if (existing) {
          existing.confidence = Math.min(1, existing.confidence + 0.2);
        } else if (fundamentals.length < 8) {
          fundamentals.push({
            freq: autoPitch,
            noteNumber: autoMidi,
            noteName: midiToNoteName(autoMidi),
            confidence: 0.5,
            amplitude: 0,
            harmonicCount: 0,
            harmonicEnergy: 0
          });
        }
      }
    }

    return fundamentals
      .filter(f => f.confidence >= 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);
  }

  _autocorrelation() {
    const data = this.timeDomainData;
    const len = data.length;

    let rms = 0;
    for (let i = 0; i < len; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / len);
    if (rms < 0.008) return -1;

    const minPeriod = Math.floor(this.sampleRate / this.maxFreq);
    const maxPeriod = Math.min(
      Math.floor(this.sampleRate / this.minFreq),
      Math.floor(len / 2)
    );

    let bestCorrelation = 0;
    let bestPeriod = 0;

    // Use YIN-like approach
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      let norm1 = 0;
      let norm2 = 0;
      const windowSize = Math.min(len - period, 2048);

      for (let i = 0; i < windowSize; i++) {
        correlation += data[i] * data[i + period];
        norm1 += data[i] * data[i];
        norm2 += data[i + period] * data[i + period];
      }

      const normalizer = Math.sqrt(norm1 * norm2);
      if (normalizer > 0) correlation /= normalizer;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    if (bestCorrelation > 0.5 && bestPeriod > 0) {
      // Parabolic interpolation around the peak
      if (bestPeriod > minPeriod && bestPeriod < maxPeriod - 1) {
        const c0 = this._correlationAt(bestPeriod - 1);
        const c1 = bestCorrelation;
        const c2 = this._correlationAt(bestPeriod + 1);
        const denom = c0 - 2 * c1 + c2;
        if (denom !== 0) {
          const delta = 0.5 * (c0 - c2) / denom;
          return this.sampleRate / (bestPeriod + delta);
        }
      }
      return this.sampleRate / bestPeriod;
    }
    return -1;
  }

  _correlationAt(period) {
    const data = this.timeDomainData;
    const len = data.length;
    let correlation = 0;
    let norm1 = 0;
    let norm2 = 0;
    const windowSize = Math.min(len - period, 2048);

    for (let i = 0; i < windowSize; i++) {
      correlation += data[i] * data[i + period];
      norm1 += data[i] * data[i];
      norm2 += data[i + period] * data[i + period];
    }

    const normalizer = Math.sqrt(norm1 * norm2);
    return normalizer > 0 ? correlation / normalizer : 0;
  }

  getActiveNotes() {
    return Array.from(this.activeNotes.keys());
  }
}
