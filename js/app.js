/**
 * Piano Trainer - Main Application
 * Orchestrates MIDI parsing, rendering, pitch detection, and game modes
 */
class PianoTrainerApp {
  constructor() {
    this.midiParser = new MidiParser();
    this.pitchDetector = new PitchDetector();
    this.pianoRenderer = null;
    this.sheetRenderer = null;

    this.midiData = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTime = 0;
    this.playbackSpeed = 1;
    this.startTimestamp = 0;
    this.pauseTime = 0;
    this.animFrame = null;
    this.micEnabled = false;

    this.mode = 'watch';
    this.showLeftHand = true;
    this.showRightHand = true;
    this.showSheet = true;

    this.score = { correct: 0, missed: 0, wrong: 0, total: 0 };
    this.activeTargets = new Map();
    this.matchedNotes = new Set();
    this.processedNoteKeys = new Set();
    this.wrongNotes = [];
    this.toleranceMs = 300;
    this.waitingForNotes = false;
    this._detectionTimeouts = new Map();

    this.audioCtx = null;
    this.pianoPlayer = null;
    this.pianoLoading = false;
    this.masterVolume = 80;
    this.playbackNotes = new Map();
    this.soundEnabled = true;
    this.soundedNotes = new Map();
    this.activeOscillators = [];

    // Drag state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartTime = 0;

    this._initDOM();
    this._initEventListeners();
    this._renderLoop();
  }

  _initDOM() {
    this.pianoRenderer = new PianoRenderer(document.getElementById('waterfall-canvas'));
    this.sheetRenderer = new SheetMusicRenderer(document.getElementById('sheet-canvas'));

    this.loadBtn = document.getElementById('btn-load');
    this.fileInput = document.getElementById('midi-file-input');
    this.micBtn = document.getElementById('btn-mic');
    this.sheetBtn = document.getElementById('btn-sheet');
    this.soundBtn = document.getElementById('btn-sound');

    // Transport controls
    this.playPauseBtn = document.getElementById('btn-play-pause');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    this.skipStartBtn = document.getElementById('btn-skip-start');
    this.skipBackBtn = document.getElementById('btn-skip-back');
    this.skipForwardBtn = document.getElementById('btn-skip-forward');
    this.skipEndBtn = document.getElementById('btn-skip-end');

    this.modeSelect = document.getElementById('mode-select');
    this.handSelect = document.getElementById('hand-select');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedValue = document.getElementById('speed-value');
    this.sensitivitySlider = document.getElementById('sensitivity-slider');
    this.detectionMode = document.getElementById('detection-mode');
    this.noiseCancel = document.getElementById('noise-cancel');
    this.recordBtn = document.getElementById('btn-record');
    this.recStatus = document.getElementById('rec-status');
    this.recPlayback = document.getElementById('rec-playback');
    this.recCompare = document.getElementById('rec-compare');
    this.recClose = document.getElementById('btn-rec-close');
    this.volumeSlider = document.getElementById('volume-slider');
    this.volumeVal = document.getElementById('volume-val');
    this.sensVal = document.getElementById('sens-val');
    this.calibrateBtn = document.getElementById('btn-calibrate');
    this.calOverlay = document.getElementById('cal-overlay');
    this.calNoteDisplay = document.getElementById('cal-note-display');
    this.calProgressFill = document.getElementById('cal-progress-fill');
    this.calStatusMsg = document.getElementById('cal-status-msg');
    this.calCancelBtn = document.getElementById('btn-cal-cancel');

    this.songInfoEl = document.getElementById('song-info');
    this.timeDisplay = document.getElementById('time-display');
    this.progressContainer = document.getElementById('progress-container');
    this.progressFill = document.getElementById('progress-fill');
    this.micDot = document.getElementById('mic-dot');
    this.statusText = document.getElementById('status-text');
    this.detectedNotesEl = document.getElementById('detected-notes');
    this.welcomeOverlay = document.getElementById('welcome-overlay');
    this.scoreOverlay = document.getElementById('score-overlay');
    this.scoreValue = document.getElementById('score-value');
    this.correctCount = document.getElementById('correct-count');
    this.missedCount = document.getElementById('missed-count');
    this.wrongCount = document.getElementById('wrong-count');
    this.sheetPanel = document.getElementById('sheet-panel');
    this.resultsOverlay = document.getElementById('results-overlay');
    this.volumeBars = document.querySelectorAll('.volume-bar');
  }

  _initEventListeners() {
    // File loading
    this.loadBtn.addEventListener('click', () => {
      this._onUserGesture();
      this.fileInput.click();
    });
    this.fileInput.addEventListener('change', (e) => this._handleFileLoad(e));
    document.getElementById('btn-load-welcome')?.addEventListener('click', () => {
      this._onUserGesture();
      this.fileInput.click();
    });
    document.getElementById('btn-demo')?.addEventListener('click', () => this._startDemo());

    // Transport controls
    this.playPauseBtn.addEventListener('click', () => {
      this._onUserGesture();
      this._togglePlay();
    });
    this.skipStartBtn.addEventListener('click', () => this._seek(0));
    this.skipBackBtn.addEventListener('click', () => this._seek(Math.max(0, this.currentTime - 5)));
    this.skipForwardBtn.addEventListener('click', () => {
      if (this.midiData) this._seek(Math.min(this.midiData.duration, this.currentTime + 5));
    });
    this.skipEndBtn.addEventListener('click', () => {
      if (this.midiData) this._seek(this.midiData.duration);
    });

    // Mic
    this.micBtn.addEventListener('click', () => {
      this._onUserGesture();
      this._toggleMic();
    });

    // Sheet toggle
    this.sheetBtn.addEventListener('click', () => this._toggleSheet());

    // Sound toggle
    this.soundBtn.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      this.soundBtn.textContent = this.soundEnabled ? 'Sound' : 'Mute';
      this.soundBtn.classList.toggle('active', this.soundEnabled);
    });

    // Mode
    this.modeSelect.addEventListener('change', (e) => {
      this.mode = e.target.value;
      this._resetScore();
      this._updateUI();
    });

    // Hand selection
    this.handSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      this.showLeftHand = val === 'both' || val === 'left';
      this.showRightHand = val === 'both' || val === 'right';
    });

    // Speed slider
    this.speedSlider.addEventListener('input', (e) => {
      this.playbackSpeed = parseFloat(e.target.value);
      this.speedValue.textContent = this.playbackSpeed.toFixed(2) + 'x';
    });

    // Sensitivity
    this.sensitivitySlider.addEventListener('input', (e) => {
      this.pitchDetector.setSensitivity(parseFloat(e.target.value));
      if (this.sensVal) this.sensVal.textContent = parseFloat(e.target.value).toFixed(2);
    });

    // Detection mode
    this.detectionMode.addEventListener('change', (e) => {
      this.pitchDetector.setMode(e.target.value);
    });

    // Noise cancellation mode
    this.noiseCancel.addEventListener('change', (e) => {
      this.pitchDetector.setNoiseCancel(e.target.value);
    });

    // Record 10s noise cancellation demo
    this.recordBtn.addEventListener('click', () => this._startRecording());
    this.recClose.addEventListener('click', () => {
      this.recPlayback.style.display = 'none';
      this.recCompare.querySelectorAll('audio').forEach(a => { a.pause(); a.src = ''; });
      this.recCompare.innerHTML = '';
    });

    // Volume slider (0-400%)
    const updateVolume = (val) => {
      this.masterVolume = parseInt(val);
      const pct = val + '%';
      this.volumeVal.textContent = pct;
      if (this.volumeSlider) this.volumeSlider.value = val;
    };
    this.volumeSlider.addEventListener('input', (e) => updateVolume(e.target.value));

    // Calibration
    this.calibrateBtn.addEventListener('click', async () => {
      if (!this.micEnabled) {
        const ok = await this.pitchDetector.start();
        if (!ok) return;
        this.micEnabled = true;
        this.micBtn.classList.add('active');
        this.micDot.classList.add('active');
      }
      this._startCalibration();
    });
    this.calCancelBtn.addEventListener('click', () => this._cancelCalibration());

    // Pitch detector calibration hook
    this.pitchDetector.onNotesDetected = (notes) => {
      if (this._calibrating && notes.length > 0) {
        if (this._calWaitingForA4 && notes[0].noteNumber === 69) {
          this._calStableFrames++;
          if (this._calStableFrames >= 6) this._recordCalibration(notes[0].frequency);
        } else if (this._calWaitingForA4) {
          this._calStableFrames = 0;
        }
      }
    };

    // Progress bar click and smooth drag
    this.progressContainer.addEventListener('click', (e) => {
      if (!this.midiData) return;
      const rect = this.progressContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this._seek(ratio * this.midiData.duration);
    });
    let progressDragging = false;
    this.progressContainer.addEventListener('mousedown', (e) => {
      progressDragging = true;
      const rect = this.progressContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this._seek(ratio * this.midiData.duration);
    });
    document.addEventListener('mousemove', (e) => {
      if (!progressDragging || !this.midiData) return;
      const rect = this.progressContainer.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this._seek(ratio * this.midiData.duration);
    });
    document.addEventListener('mouseup', () => {
      if (progressDragging) {
        progressDragging = false;
      }
    });

    // Drag on waterfall canvas (horizontal scrub)
    const waterfallCanvas = document.getElementById('waterfall-canvas');
    waterfallCanvas.addEventListener('mousedown', (e) => this._onDragStart(e));
    document.addEventListener('mousemove', (e) => this._onDragMove(e));
    document.addEventListener('mouseup', () => this._onDragEnd());

    // Waterfall zoom and scroll with mouse wheel (disabled — caused crashes)
    waterfallCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
    }, { passive: false });

    // Resizer between waterfall and sheet music
    this.resizer = document.getElementById('resizer');
    this.canvasContainer = document.getElementById('canvas-container');
    this.mainArea = document.getElementById('main-area');
    if (this.resizer) {
      this.resizer.addEventListener('mousedown', (e) => this._onResizerStart(e));
      document.addEventListener('mousemove', (e) => this._onResizerMove(e));
      document.addEventListener('mouseup', () => this._onResizerEnd());
    }

    // Sheet music vertical scroll
    const sheetCanvas = document.getElementById('sheet-canvas');
    sheetCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sheetRenderer.setScrollY(e.deltaY * 0.5);
    }, { passive: false });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this._togglePlay();
      } else if (e.code === 'Escape') {
        this._stop();
      } else if (e.code === 'KeyM') {
        this._toggleMic();
      } else if (e.code === 'KeyS') {
        this._toggleSheet();
      } else if (e.code === 'ArrowLeft') {
        this._seek(Math.max(0, this.currentTime - 5));
      } else if (e.code === 'ArrowRight') {
        if (this.midiData) this._seek(Math.min(this.midiData.duration, this.currentTime + 5));
      } else if (e.code === 'Home') {
        this._seek(0);
      } else if (e.code === 'End') {
        if (this.midiData) this._seek(this.midiData.duration);
      }
    });

    // Piano click (preview)
    waterfallCanvas.addEventListener('mousedown', (e) => {
      if (this.isDragging) return;
      const noteNum = this.pianoRenderer.hitTest(e.clientX, e.clientY);
      if (noteNum >= 0) {
        this._onUserGesture();
        this.pianoRenderer.setPressed(noteNum, true);
        this._playPreviewNote(noteNum);
      }
    });
    waterfallCanvas.addEventListener('mouseup', () => {
      this.pianoRenderer.pressedKeys.clear();
      this._stopAllPreviewNotes();
    });

    // Pitch detector callbacks
    this.pitchDetector.onNoteOn = (noteNum, confidence) => {
      this.pianoRenderer.setPressed(noteNum, true);
      this.pianoRenderer.setDetectionHighlight(noteNum, '#FFD700');
      if (this.mode !== 'watch' && this.isPlaying) {
        this._handleDetectedNote(noteNum, confidence);
      }
    };

    this.pitchDetector.onNoteOff = (noteNum) => {
      this.pianoRenderer.setPressed(noteNum, false);
      // Keep detection gold outline visible briefly so user can see it
      if (this.pianoRenderer.detectionHighlights.has(noteNum)) {
        if (this._detectionTimeouts.has(noteNum)) clearTimeout(this._detectionTimeouts.get(noteNum));
        this._detectionTimeouts.set(noteNum, setTimeout(() => {
          this.pianoRenderer.setDetectionHighlight(noteNum, null);
          this._detectionTimeouts.delete(noteNum);
        }, 400));
      }
    };

    // Drag and drop
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.mid') || file.name.endsWith('.midi'))) {
        this._loadFile(file);
      }
    });

    // Results
    document.getElementById('btn-close-results')?.addEventListener('click', () => {
      this.resultsOverlay.classList.remove('visible');
    });
    document.getElementById('btn-retry')?.addEventListener('click', () => {
      this.resultsOverlay.classList.remove('visible');
      this._stop();
      this._togglePlay();
    });
  }

  _onDragStart(e) {
    if (!this.midiData) return;
    // Only drag if clicking in the main area (not on piano keys)
    const rect = this.pianoRenderer.canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y > this.pianoRenderer.pianoY) return; // Don't drag on piano keys

    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartTime = this.currentTime;
    this.pianoRenderer.canvas.style.cursor = 'grabbing';
  }

  _onDragMove(e) {
    if (!this.isDragging || !this.midiData) return;
    const dx = this.dragStartX - e.clientX;
    const dt = dx / this.pianoRenderer.pixelsPerSecond;
    this.currentTime = Math.max(0, Math.min(this.midiData.duration, this.dragStartTime + dt));
    if (this.isPlaying && !this.isPaused) {
      this.startTimestamp = performance.now() - (this.currentTime * 1000 / this.playbackSpeed);
    }
  }

  _onDragEnd() {
    this.isDragging = false;
    this.pianoRenderer.canvas.style.cursor = 'default';
  }

  _onResizerStart(e) {
    this.isResizing = true;
    this.resizeStartY = e.clientY;
    this.resizeStartSheetHeight = this.sheetPanel.offsetHeight;
    this.resizer.style.cursor = 'row-resize';
    e.preventDefault();
  }

  _onResizerMove(e) {
    if (!this.isResizing) return;
    const dy = e.clientY - this.resizeStartY; // positive when dragging down
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.6, this.resizeStartSheetHeight - dy));
    this.sheetPanel.style.height = newHeight + 'px';
    this.sheetPanel.style.flex = 'none';
    this.sheetRenderer._resize();
  }

  _onResizerEnd() {
    this.isResizing = false;
    this.resizer.style.cursor = 'row-resize';
  }

  async _handleFileLoad(e) {
    const file = e.target.files[0];
    if (file) await this._loadFile(file);
  }

  _onUserGesture() {
    this._ensureAudio();
    this._ensurePianoLoaded();
  }

  async _startDemo() {
    this._onUserGesture();
    try {
      const resp = await fetch('/demo/demo.mid');
      const arrayBuffer = await resp.arrayBuffer();
      this.midiData = this.midiParser.parse(arrayBuffer);
      this.songInfoEl.textContent = 'River Flows In You — Yiruma';
      this.welcomeOverlay.style.display = 'none';
      this.resultsOverlay.classList.remove('visible');
      this._stop();
      this._resetScore();
      this._updateUI();
      this._ensurePianoLoaded();
      this.statusText.textContent = `Loaded: ${this.midiData.notes.length} notes, ${this.midiData.measures.length} measures`;
    } catch (e) {
      console.error('Demo failed:', e);
      this.statusText.textContent = 'Error: ' + e.message;
    }
  }

  async _loadFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.midiData = this.midiParser.parse(arrayBuffer);

      const name = file.name.replace(/\.(mid|midi)$/i, '').replace(/_/g, ' ');
      this.songInfoEl.textContent = name;
      this.welcomeOverlay.style.display = 'none';
      this.resultsOverlay.classList.remove('visible');

      this._stop();
      this._resetScore();
      this._updateUI();
      this._ensurePianoLoaded();

      console.log('MIDI loaded:', {
        format: this.midiData.header.format,
        tracks: this.midiData.tracks.length,
        notes: this.midiData.notes.length,
        duration: this.midiData.duration.toFixed(1) + 's',
        measures: this.midiData.measures.length,
        rightHandNotes: this.midiData.notes.filter(n => n.hand === 'right').length,
        leftHandNotes: this.midiData.notes.filter(n => n.hand === 'left').length
      });

      this.statusText.textContent = `Loaded: ${this.midiData.notes.length} notes, ${this.midiData.measures.length} measures`;
    } catch (err) {
      console.error('Failed to parse MIDI:', err);
      this.statusText.textContent = 'Error: ' + err.message;
    }
  }

  _togglePlay() {
    if (!this.midiData) return;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.isPaused = false;
      this.startTimestamp = performance.now() - (this.currentTime * 1000 / this.playbackSpeed);
      this._updatePlayButton();

      if (this.mode !== 'watch') {
        this.scoreOverlay.classList.add('visible');
        if (this.currentTime === 0) this._resetScore();
      }
    } else if (!this.isPaused) {
      this.isPaused = true;
      this.pauseTime = this.currentTime;
      this._updatePlayButton();
    } else {
      this.isPaused = false;
      this.startTimestamp = performance.now() - (this.pauseTime * 1000 / this.playbackSpeed);
      this._updatePlayButton();
    }
  }

  _updatePlayButton() {
    if (!this.isPlaying) {
      this.iconPlay.style.display = 'block';
      this.iconPause.style.display = 'none';
      this.playPauseBtn.classList.remove('active');
    } else if (this.isPaused) {
      this.iconPlay.style.display = 'block';
      this.iconPause.style.display = 'none';
      this.playPauseBtn.classList.remove('active');
    } else {
      this.iconPlay.style.display = 'none';
      this.iconPause.style.display = 'block';
      this.playPauseBtn.classList.add('active');
    }
  }

  _seek(time) {
    if (!this.midiData) return;
    this.currentTime = Math.max(0, Math.min(this.midiData.duration, time));
    this._ensureAudio();
    if (this.isPlaying && !this.isPaused) {
      this.startTimestamp = performance.now() - (this.currentTime * 1000 / this.playbackSpeed);
    }
    this.soundedNotes.clear();
    this._stopAllActiveOscillators();
  }

  _stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTime = 0;
    this.waitingForNotes = false;
    this._updatePlayButton();
    this.pianoRenderer.clearHighlights();
    this.pianoRenderer.clearDetectionHighlights();
    this.pianoRenderer.pressedKeys.clear();
    this.activeTargets.clear();
    this.processedNoteKeys.clear();
    this.soundedNotes.clear();
    this._stopAllPreviewNotes();
    this._stopAllMidiNotes();
  }

  async _toggleMic() {
    if (this.micEnabled) {
      this.pitchDetector.stop();
      this.micEnabled = false;
      this.micBtn.classList.remove('active');
      this.micDot.classList.remove('active');
      this.micDot.classList.remove('error');
      this.pianoRenderer.pressedKeys.clear();
    } else {
      const ok = await this.pitchDetector.start();
      if (ok) {
        this.micEnabled = true;
        this.micBtn.classList.add('active');
        this.micDot.classList.add('active');
      } else {
        this.micDot.classList.add('error');
        this.statusText.textContent = 'Microphone access denied';
      }
    }
  }

  _startCalibration() {
    this._calibrating = true;
    this._calWaitingForA4 = true;
    this._calStableFrames = 0;
    // Save and switch to Standard mode for raw frequency detection
    this._savedDetectionMode = this.detectionMode.value;
    if (this._savedDetectionMode !== 'standard') {
      this.detectionMode.value = 'standard';
      this.pitchDetector.setMode('standard');
    }
    this.calibrateBtn.textContent = 'Tuning';
    this.calibrateBtn.disabled = true;
    this.calNoteDisplay.textContent = 'A4';
    this.calProgressFill.style.width = '0%';
    this.calStatusMsg.textContent = 'Play A4 on your piano';
    this.calStatusMsg.className = 'cal-status-msg';
    this.calOverlay.classList.add('visible');
  }

  _cancelCalibration() {
    this._calibrating = false;
    this._calWaitingForA4 = false;
    this._calStableFrames = 0;
    this.calOverlay.classList.remove('visible');
    this.calibrateBtn.textContent = 'Tune';
    this.calibrateBtn.disabled = false;
    // Restore detection mode
    if (this._savedDetectionMode && this._savedDetectionMode !== this.detectionMode.value) {
      this.detectionMode.value = this._savedDetectionMode;
      this.pitchDetector.setMode(this._savedDetectionMode);
    }
    this._savedDetectionMode = null;
  }

  _recordCalibration(freq) {
    if (!this._calibrating || !this._calWaitingForA4) return;
    this._calWaitingForA4 = false;
    this.pitchDetector.calibrate(freq);
    this.calStatusMsg.textContent = 'Calibrated! ✓';
    this.calStatusMsg.className = 'cal-status-msg done';
    this.calProgressFill.style.width = '100%';
    setTimeout(() => {
      this.calOverlay.classList.remove('visible');
      this.calibrateBtn.textContent = 'Tuned';
      this.calibrateBtn.disabled = false;
      // Restore detection mode
      if (this._savedDetectionMode && this._savedDetectionMode !== this.detectionMode.value) {
        this.detectionMode.value = this._savedDetectionMode;
        this.pitchDetector.setMode(this._savedDetectionMode);
      }
      this._savedDetectionMode = null;
      setTimeout(() => { this.calibrateBtn.textContent = 'Tune'; }, 3000);
    }, 1200);
    this._calibrating = false;
  }

  _startRecording() {
    if (!this.micEnabled) { this.statusText.textContent = 'Enable mic first'; return; }
    if (this._recording) return;
    this._recording = true;
    this.recordBtn.classList.add('active');
    this.recordBtn.style.color = '#FF1744';
    this.recStatus.textContent = 'REC 0s';

    const stream = this.pitchDetector._stream;
    if (!stream) { this._recording = false; return; }

    // Capture raw PCM via ScriptProcessorNode — no Opus compression, no browser processing
    const AC = window.AudioContext || window.webkitAudioContext;
    const rawCtx = new AC();
    const src = rawCtx.createMediaStreamSource(stream);
    const scNode = rawCtx.createScriptProcessor(4096, 1, 1);
    const silent = rawCtx.createGain();
    silent.gain.value = 0;

    const pcmChunks = [];
    scNode.onaudioprocess = (e) => {
      pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

    src.connect(scNode);
    scNode.connect(silent);
    silent.connect(rawCtx.destination);

    let sec = 0;
    const timer = setInterval(async () => {
      sec++;
      this.recStatus.textContent = 'REC ' + sec + 's';
      if (sec >= 10) {
        clearInterval(timer);
        scNode.disconnect();
        silent.disconnect();

        this._recording = false;
        this.recordBtn.classList.remove('active');
        this.recordBtn.style.color = '';
        this.recStatus.textContent = 'Processing...';
        this.recCompare.innerHTML = '';
        this.recPlayback.style.display = 'block';

        // Concatenate all PCM chunks
        let totalLen = 0;
        for (const c of pcmChunks) totalLen += c.length;
        const ch = new Float32Array(totalLen);
        let off = 0;
        for (const c of pcmChunks) { ch.set(c, off); off += c.length; }
        const sr = rawCtx.sampleRate;

        // Raw WAV — truly raw PCM, no codec artifacts
        const rawRow = document.createElement('div');
        rawRow.className = 'rec-compare-row';
        rawRow.innerHTML = '<label>Raw</label><audio controls src="' + URL.createObjectURL(new Blob([this._encodeWAV(sr, ch)], { type: 'audio/wav' })) + '"></audio>';
        this.recCompare.appendChild(rawRow);

        // Placeholder rows for Spectral and DF3
        const spRow = document.createElement('div');
        spRow.className = 'rec-compare-row';
        spRow.innerHTML = '<label style="color:#7c9cff">Spectral</label><span style="color:#888;font-size:12px">Processing…</span>';
        this.recCompare.appendChild(spRow);

        const dfRow = document.createElement('div');
        dfRow.className = 'rec-compare-row';
        dfRow.innerHTML = '<label style="color:#4CAF50">DF3</label><span style="color:#888;font-size:12px">Processing…</span>';
        this.recCompare.appendChild(dfRow);

        this.recStatus.textContent = '';

        // Process spectral + DF3 using the same raw PCM
        this._processDecodedAudio(sr, ch, spRow, dfRow, rawCtx);
      }
    }, 1000);
  }

  _encodeWAV(sampleRate, samples) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buf;
  }

  async _processDecodedAudio(sr, ch, spRow, dfRow, audioCtx) {
    try {
      // Spectral (sync — fast, <100ms for 10s recording)
      try {
        const denoiser = new SpectralSubtractor({ sampleRate: sr, fftSize: 2048, noiseProfileFrames: 5 });
        const cleaned = new Float32Array(ch.length);
        for (let i = 0; i < ch.length; i += 2048) {
          const end = Math.min(i + 2048, ch.length);
          const frame = ch.subarray(i, end);
          try {
            const result = denoiser.processFrame(frame);
            if (result && result.audio) cleaned.set(result.audio.subarray(0, end - i), i);
            else cleaned.set(frame, i);
          } catch (e) { cleaned.set(frame, i); }
        }
        spRow.innerHTML = '<label style="color:#7c9cff">Spectral</label><audio controls src="' + URL.createObjectURL(new Blob([this._encodeWAV(sr, cleaned)], { type: 'audio/wav' })) + '"></audio>';
      } catch (e) { spRow.innerHTML = '<label style="color:#7c9cff">Spectral</label><span style="color:#f44;font-size:12px">Failed</span>'; }

      // DeepFilterNet3 — offline via OfflineAudioContext
      try {
        const df3 = this.pitchDetector._df;
        if (!df3 || !df3.isInitialized) throw new Error('DF3 not loaded');
        const offCtx = new OfflineAudioContext(1, ch.length, sr);
        const dfNode = await df3.createAudioWorkletNode(offCtx);
        const src = offCtx.createBufferSource();
        const buf = offCtx.createBuffer(1, ch.length, sr);
        buf.getChannelData(0).set(ch);
        src.buffer = buf;
        src.connect(dfNode);
        dfNode.connect(offCtx.destination);
        src.start();
        const rendered = await offCtx.startRendering();
        const out = rendered.getChannelData(0);
        dfRow.innerHTML = '<label style="color:#4CAF50">DF3</label><audio controls src="' + URL.createObjectURL(new Blob([this._encodeWAV(sr, out)], { type: 'audio/wav' })) + '"></audio>';
      } catch (e) {
        console.warn('DF3 offline failed:', e.message);
        dfRow.innerHTML = '<label style="color:#4CAF50">DF3</label><span style="color:#f44;font-size:12px">Failed</span>';
      }

      audioCtx.close();
    } catch (e) {
      spRow.innerHTML = '<label style="color:#7c9cff">Spectral</label><span style="color:#f44;font-size:12px">Failed</span>';
      dfRow.innerHTML = '<label style="color:#4CAF50">DF3</label><span style="color:#f44;font-size:12px">Failed</span>';
    }
  }

  _toggleSheet() {
    this.showSheet = !this.showSheet;
    this.sheetPanel.classList.toggle('visible', this.showSheet);
    if (this.resizer) this.resizer.classList.toggle('visible', this.showSheet);
    this.sheetBtn.classList.toggle('active', this.showSheet);
    if (this.showSheet) {
      this.sheetPanel.style.height = '260px';
      this.sheetPanel.style.flex = 'none';
    }
    setTimeout(() => {
      this.pianoRenderer._resize();
      if (this.showSheet) this.sheetRenderer._resize();
    }, 50);
  }

  _resetScore() {
    this.score = { correct: 0, missed: 0, wrong: 0, total: 0 };
    this.matchedNotes.clear();
    this.processedNoteKeys.clear();
    this.wrongNotes = [];
    this.activeTargets.clear();
    this.pianoRenderer.clearResults();
    this.sheetRenderer.clearResults();
    this._updateScoreDisplay();
  }

  _updateScoreDisplay() {
    const total = this.score.correct + this.score.missed;
    const pct = total > 0 ? Math.round((this.score.correct / total) * 100) : 0;
    this.scoreValue.textContent = pct + '%';
    this.correctCount.textContent = this.score.correct;
    this.missedCount.textContent = this.score.missed;
    this.wrongCount.textContent = this.score.wrong;
  }

  _handleDetectedNote(noteNum, confidence) {
    let matched = false;
    for (const [noteKey, target] of this.activeTargets) {
      if (target.noteNumber === noteNum && !this.matchedNotes.has(noteKey)) {
        this.matchedNotes.add(noteKey);
        this.score.correct++;
        this.pianoRenderer.setDetectionHighlight(noteNum, '#FFD700');
        this.pianoRenderer.setNoteResult(target, 'correct');
        this.sheetRenderer.setNoteResult(target, 'correct');
        matched = true;
        this.activeTargets.delete(noteKey);
        break;
      }
    }

    if (!matched && this.activeTargets.size > 0) {
      this.score.wrong++;
      this.pianoRenderer.setDetectionHighlight(noteNum, '#FF1744');
      setTimeout(() => this.pianoRenderer.setDetectionHighlight(noteNum, null), 400);
    }

    if (this.waitingForNotes && this.activeTargets.size === 0) {
    this.waitingForNotes = false;
    this._calibrating = false;
    this._calStableFrames = 0;
    this._recording = false;
      this.startTimestamp = performance.now() - (this.currentTime * 1000 / this.playbackSpeed);
    }

    this._updateScoreDisplay();
  }

  _updateTargets() {
    if (!this.midiData || this.mode === 'watch') return;

    const tolerance = this.toleranceMs / 1000;
    const notes = this.midiData.notes;

    for (const note of notes) {
      if (!this.showLeftHand && note.hand === 'left') continue;
      if (!this.showRightHand && note.hand === 'right') continue;

      const noteKey = `${note.startTick}-${note.noteNumber}`;
      if (this.matchedNotes.has(noteKey) || this.processedNoteKeys.has(noteKey)) continue;

      if (note.startTime <= this.currentTime + tolerance * 0.5) {
        this.activeTargets.set(noteKey, note);
        this.processedNoteKeys.add(noteKey);
        this.score.total++;
      }
    }

    for (const [noteKey, target] of this.activeTargets) {
      if (target.startTime < this.currentTime - tolerance) {
        this.score.missed++;
        this.activeTargets.delete(noteKey);
        this.pianoRenderer.setNoteResult(target, 'missed');
        this.sheetRenderer.setNoteResult(target, 'missed');
        this._updateScoreDisplay();
      }
    }

    if (this.mode === 'play-along' && this.micEnabled && this.activeTargets.size > 0) {
      if (!this.waitingForNotes) {
        this.waitingForNotes = true;
        this.waitStartTime = performance.now();
      }
    }
  }

  _renderLoop() {
    if (this.isPlaying && !this.isPaused && !this.waitingForNotes) {
      this.currentTime = (performance.now() - this.startTimestamp) * this.playbackSpeed / 1000;
      if (this.midiData && this.currentTime >= this.midiData.duration + 1) {
        this._onSongEnd();
      }
    }

    if (this.isPlaying && this.midiData && this.soundEnabled) {
      this._updateMidiSound();
    }

    if (this.isPlaying && this.mode !== 'watch') {
      this._updateTargets();
    }

    if (this.midiData) {
      this.pianoRenderer.render(
        this.currentTime,
        this.midiData.notes,
        this.midiData.measures,
        { showLeftHand: this.showLeftHand, showRightHand: this.showRightHand }
      );

      if (this.showSheet) {
        this.sheetRenderer.render(
          this.currentTime,
          this.midiData.notes,
          this.midiData.measures,
          this.midiData,
          { showLeftHand: this.showLeftHand, showRightHand: this.showRightHand }
        );
      }

      const progress = this.midiData.duration > 0
        ? (this.currentTime / this.midiData.duration) * 100 : 0;
      this.progressFill.style.width = Math.min(100, progress) + '%';

      this.timeDisplay.textContent = this._formatTime(this.currentTime) +
        ' / ' + this._formatTime(this.midiData.duration);

      // Piano key playback highlighting with waterfall colors
      const activeNoteNumbers = new Set();
      for (const note of this.midiData.notes) {
        if (note.startTime <= this.currentTime && note.endTime >= this.currentTime) {
          if (!this.showLeftHand && note.hand === 'left') continue;
          if (!this.showRightHand && note.hand === 'right') continue;
          activeNoteNumbers.add(note.noteNumber);
        }
      }
      for (const noteNum of activeNoteNumbers) {
        const rep = this.midiData.notes.find(n =>
          n.noteNumber === noteNum &&
          n.startTime <= this.currentTime &&
          n.endTime >= this.currentTime
        );
        if (rep) {
          const color = rep.hand === 'right'
            ? this.pianoRenderer.colors.rightHand.active
            : this.pianoRenderer.colors.leftHand.active;
          this.pianoRenderer.setHighlight(noteNum, color);
        }
      }
      for (let n = 21; n <= 108; n++) {
        if (!activeNoteNumbers.has(n) && !this.pitchDetector.activeNotes.has(n)) {
          this.pianoRenderer.setHighlight(n, null);
        }
      }
    } else {
      this.pianoRenderer.render(0, [], null, {});
    }

    if (this.micEnabled) {
      const vol = this.pitchDetector.volumeLevel;
      const numBars = this.volumeBars.length;
      for (let i = 0; i < numBars; i++) {
        const threshold = (i + 1) / numBars;
        if (vol >= threshold) {
          this.volumeBars[i].classList.add('active');
          this.volumeBars[i].classList.toggle('high', i >= numBars - 2);
        } else {
          this.volumeBars[i].classList.remove('active', 'high');
        }
      }

      const detected = this.pitchDetector.detectedNotes;
      this.detectedNotesEl.textContent = detected.length > 0
        ? 'Detected: ' + detected.map(n => n.noteName).join(', ')
        : '';

      // DEBUG layout shift (enable: _debugLayout = true in console)
      if (window._debugLayout) {
        const br = this.detectedNotesEl.closest('.bottom-right');
        const tb = document.querySelector('.transport-bar');
        if (br && tb) {
          if (!this._lastLayoutLog || performance.now() - this._lastLayoutLog > 500) {
            this._lastLayoutLog = performance.now();
            console.log('br.w=', br.offsetWidth, 'tb.w=', tb.offsetWidth, 'sg.w=', br.querySelector('.status-group')?.offsetWidth, 'txt=', JSON.stringify(this.detectedNotesEl.textContent));
          }
        }
      }
    }

    this.animFrame = requestAnimationFrame(() => this._renderLoop());
  }

  _updateMidiSound() {
    this._ensureAudio();

    const now = this.currentTime;
    const lookahead = 0.05;

    for (const note of this.midiData.notes) {
      const noteKey = `${note.startTick}-${note.noteNumber}`;

      if (note.startTime <= now + lookahead && note.endTime > now) {
        if (!this.soundedNotes.has(noteKey)) {
          this._playMidiNote(note.noteNumber, note.velocity / 127, note.endTime - note.startTime);
          this.soundedNotes.set(noteKey, note);
        }
      }

      if (note.endTime <= now && this.soundedNotes.has(noteKey)) {
        this.soundedNotes.delete(noteKey);
      }
    }

    for (const [noteKey, note] of this.soundedNotes) {
      if (note.endTime <= now) {
        this.soundedNotes.delete(noteKey);
      }
    }
  }

  _playMidiNote(noteNum, velocity, duration) {
    this._ensureAudio();
    if (this.pianoPlayer) {
      this.pianoPlayer.play(noteNum, this.audioCtx.currentTime, {
        duration: Math.min(duration, 4),
        gain: Math.max(0.05, velocity * 0.3) * (this.masterVolume / 50),
      });
      return;
    }

    // Fallback: harmonic stack oscillator
    const freq = midiToFrequency(noteNum);
    const now = this.audioCtx.currentTime;
    const dur = Math.min(duration, 3);
    const vol = Math.max(0.02, velocity * 0.2);
    const lowBoost = Math.max(1, Math.pow(100 / freq, 0.35));
    const finalVol = Math.min(1, vol * lowBoost);

    const oscillators = [];
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(finalVol, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(finalVol * 0.5, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const addOsc = (type, freqMult, gainFactor) => {
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq * freqMult, now);
      g.gain.setValueAtTime(gainFactor, now);
      o.connect(g);
      g.connect(gain);
      o.start(now);
      o.stop(now + dur);
      oscillators.push(o);
    };

    addOsc('triangle', 1, 0.5);
    addOsc('sine', 2, 0.3);
    addOsc('sine', 3, 0.12);
    addOsc('sine', 4, 0.06);
    addOsc('sawtooth', 1, 0.15);

    gain.connect(this.audioCtx.destination);

    for (const o of oscillators) {
      o.onended = () => {
        const idx = this.activeOscillators.indexOf(o);
        if (idx >= 0) this.activeOscillators.splice(idx, 1);
      };
      this.activeOscillators.push(o);
    }
  }

  _stopAllMidiNotes() {
    this.soundedNotes.clear();
    this._stopAllActiveOscillators();
  }

  _ensureAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  async _ensurePianoLoaded() {
    this._ensureAudio();
    if (this.pianoPlayer) return;
    if (this.pianoLoading) return;
    if (typeof Soundfont === 'undefined') return;
    this.pianoLoading = true;
    try {
      this.pianoPlayer = await Soundfont.instrument(this.audioCtx, 'acoustic_grand_piano', {
        soundfont: 'MusyngKite',
        format: 'mp3',
        gain: 0.6,
      });
    } catch (e) {
      console.warn('Failed to load grand piano soundfont, using fallback:', e);
      this.pianoPlayer = null;
    }
    this.pianoLoading = false;
  }

  _stopAllActiveOscillators() {
    if (this.pianoPlayer) {
      this.pianoPlayer.stop();
    }
    for (const o of this.activeOscillators) {
      try { o.stop(); } catch (e) {}
    }
    this.activeOscillators = [];
  }

  _onSongEnd() {
    this._stop();
    if (this.mode !== 'watch') {
      this._showResults();
    }
  }

  _showResults() {
    const total = this.score.correct + this.score.missed;
    const pct = total > 0 ? Math.round((this.score.correct / total) * 100) : 0;

    let grade, gradeClass;
    if (pct >= 95) { grade = 'S'; gradeClass = 'grade-s'; }
    else if (pct >= 85) { grade = 'A'; gradeClass = 'grade-a'; }
    else if (pct >= 70) { grade = 'B'; gradeClass = 'grade-b'; }
    else if (pct >= 55) { grade = 'C'; gradeClass = 'grade-c'; }
    else if (pct >= 40) { grade = 'D'; gradeClass = 'grade-d'; }
    else { grade = 'F'; gradeClass = 'grade-f'; }

    document.getElementById('result-grade').textContent = grade;
    document.getElementById('result-grade').className = 'grade ' + gradeClass;
    document.getElementById('result-accuracy').textContent = pct + '%';
    document.getElementById('result-correct').textContent = this.score.correct;
    document.getElementById('result-missed').textContent = this.score.missed;
    document.getElementById('result-wrong').textContent = this.score.wrong;

    this.resultsOverlay.classList.add('visible');
  }

  _updateUI() {
    this.playPauseBtn.disabled = !this.midiData;
    this.soundBtn.classList.toggle('active', this.soundEnabled);

    if (this.mode === 'watch') {
      this.scoreOverlay.classList.remove('visible');
    }
  }

  _formatTime(seconds) {
    if (!seconds || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  _playPreviewNote(noteNum) {
    this._ensureAudio();
    if (this.pianoPlayer) {
      this.pianoPlayer.play(noteNum, this.audioCtx.currentTime, {
        duration: 1.5,
        gain: 0.2 * (this.masterVolume / 50),
      });
      return;
    }

    const freq = midiToFrequency(noteNum);
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 1);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + 1);

    this.playbackNotes.set(noteNum, { osc, gain });
  }

  _stopAllPreviewNotes() {
    if (this.pianoPlayer) {
      this.pianoPlayer.stop();
    }
    for (const [, { osc, gain }] of this.playbackNotes) {
      try {
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(gain.gain.value, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.05);
      } catch (e) {}
    }
    this.playbackNotes.clear();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new PianoTrainerApp();
});
