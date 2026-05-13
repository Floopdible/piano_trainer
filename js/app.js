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

    this.audioCtx = null;
    this.pianoPlayer = null;
    this.pianoLoading = false;
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
    this.detectionMode = document.getElementById('detection-mode');
    this.micSensSlider = document.getElementById('mic-sens-slider');
    this.claritySlider = document.getElementById('clarity-slider');
    this.speedSliderDetect = document.getElementById('speed-slider-detect');
    this.releaseSlider = document.getElementById('release-slider');

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

    // Detection mode
    this.detectionMode.addEventListener('change', (e) => {
      this.pitchDetector.setMode(e.target.value);
      const isStd = e.target.value === 'standard';
      document.getElementById('detect-controls').style.display = isStd ? '' : 'none';
    });

    // Global sensitivity (works across both modes)
    this.micSensSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.pitchDetector.setSensitivity(v);
      document.getElementById('mic-sens-val').textContent = v.toFixed(2);
      // Sync advanced sliders
      this.claritySlider.value = v;
      this.speedSliderDetect.value = v;
      this.releaseSlider.value = v;
      this._updateSliderValues();
    });

    // Standard detection sliders
    this.claritySlider.addEventListener('input', (e) => {
      this.pitchDetector.setClarity(parseFloat(e.target.value));
      this._updateSliderValues();
    });
    this.speedSliderDetect.addEventListener('input', (e) => {
      this.pitchDetector.setSpeed(parseFloat(e.target.value));
      this._updateSliderValues();
    });
    this.releaseSlider.addEventListener('input', (e) => {
      this.pitchDetector.setRelease(parseFloat(e.target.value));
      this._updateSliderValues();
    });

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

    // Waterfall zoom and scroll with mouse wheel
    waterfallCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.midiData) return;
      if (e.shiftKey) {
        // Shift+wheel: scroll through time
        const dt = e.deltaY > 0 ? 2 : -2;
        this._seek(Math.max(0, Math.min(this.midiData.duration, this.currentTime + dt)));
      } else {
        // Wheel: zoom in/out
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        this.pianoRenderer.pixelsPerSecond = Math.max(50, Math.min(800, this.pianoRenderer.pixelsPerSecond * zoomFactor));
      }
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
      if (this.mode !== 'watch' && this.isPlaying) {
        this._handleDetectedNote(noteNum, confidence);
      }
    };

    this.pitchDetector.onNoteOff = (noteNum) => {
      this.pianoRenderer.setPressed(noteNum, false);
      this.pianoRenderer.setHighlight(noteNum, null);
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

  _updateSliderValues() {
    const c = parseFloat(this.claritySlider.value);
    const s = parseFloat(this.speedSliderDetect.value);
    const r = parseFloat(this.releaseSlider.value);
    document.getElementById('clarity-val').textContent = (0.85 - c * 0.45).toFixed(2);
    document.getElementById('speed-val').textContent = Math.round(5 - s * 3) + 'fr';
    document.getElementById('release-val').textContent = Math.round(14 - r * 11) + 'fr';
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
        this.statusText.textContent = 'Mic failed — check console for details';
      }
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
        this.pianoRenderer.setHighlight(noteNum, '#00E5FF');
        this.pianoRenderer.setNoteResult(target, 'correct');
        this.sheetRenderer.setNoteResult(target, 'correct');
        matched = true;
        this.activeTargets.delete(noteKey);
        break;
      }
    }

    if (!matched && this.activeTargets.size > 0) {
      this.score.wrong++;
      this.pianoRenderer.setHighlight(noteNum, '#FF1744');
      setTimeout(() => this.pianoRenderer.setHighlight(noteNum, null), 300);
    }

    if (this.waitingForNotes && this.activeTargets.size === 0) {
      this.waitingForNotes = false;
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
        // Don't overwrite mic detection highlights
        if (this.pitchDetector.activeNotes.has(noteNum)) continue;
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
        gain: Math.max(0.05, velocity * 0.3),
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
        gain: 0.2,
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
