/**
 * Piano & Waterfall Renderer
 * Draws the piano keyboard and falling notes on canvas
 */
class PianoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Piano config
    this.firstNote = 21;  // A0
    this.lastNote = 108;  // C8
    this.whiteKeyCount = 0;
    this.keyMap = {};
    this.pianoHeight = 90;
    this.pianoY = 0;

    // Waterfall config
    this.pixelsPerSecond = 200;
    this.lookAhead = 3; // seconds visible above piano

    // Colors
    this.colors = {
      rightHand: { fill: '#4a7aff', active: '#6a9aff', glow: 'rgba(74,122,255,0.3)' },
      leftHand: { fill: '#ff6a4a', active: '#ff8a6a', glow: 'rgba(255,106,74,0.3)' },
      correct: { fill: '#4CAF50', glow: 'rgba(76,175,80,0.4)' },
      wrong: { fill: '#f44336', glow: 'rgba(244,67,54,0.4)' },
      missed: { fill: '#FF9800', glow: 'rgba(255,152,0,0.3)' },
      whiteKey: '#f8f8f8',
      whiteKeyPressed: '#d0d8ff',
      whiteKeyBorder: '#bbb',
      blackKey: '#1a1a2a',
      blackKeyPressed: '#3a4a7a',
      background: '#0a0a1a',
      measureLine: 'rgba(255,255,255,0.08)',
      beatLine: 'rgba(255,255,255,0.04)'
    };

    // State
    this.pressedKeys = new Set();
    this.highlightedKeys = new Map(); // noteNum -> color
    this.detectionHighlights = new Map(); // noteNum -> color (gold outline)
    this.noteResults = new Map(); // note id -> 'correct' | 'wrong' | 'missed'

    this._buildKeyMap();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _buildKeyMap() {
    this.whiteKeyCount = 0;
    this.keyMap = {};

    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const pc = n % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(pc);
      this.keyMap[n] = {
        noteNumber: n,
        isBlack,
        whiteIndex: isBlack ? -1 : this.whiteKeyCount
      };
      if (!isBlack) this.whiteKeyCount++;
    }

    // Assign x positions for black keys relative to white keys
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const key = this.keyMap[n];
      if (key.isBlack) {
        // Find surrounding white keys
        let leftWhite = n - 1;
        while (leftWhite >= this.firstNote && this.keyMap[leftWhite].isBlack) leftWhite--;
        key.leftWhiteIndex = this.keyMap[leftWhite] ? this.keyMap[leftWhite].whiteIndex : 0;
      }
    }
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.pianoY = this.height - this.pianoHeight;
    this.waterfallHeight = this.pianoY;
    this.whiteKeyWidth = this.width / this.whiteKeyCount;
    this.blackKeyWidth = this.whiteKeyWidth * 0.6;
    this.blackKeyHeight = this.pianoHeight * 0.62;
    // Dynamic look-ahead: show enough notes to fill the screen
    this.lookAhead = Math.max(2, this.waterfallHeight / this.pixelsPerSecond + 0.5);
  }

  getKeyX(noteNumber) {
    const key = this.keyMap[noteNumber];
    if (!key) return 0;

    if (!key.isBlack) {
      return key.whiteIndex * this.whiteKeyWidth;
    } else {
      const leftX = key.leftWhiteIndex * this.whiteKeyWidth;
      return leftX + this.whiteKeyWidth - this.blackKeyWidth / 2;
    }
  }

  getKeyWidth(noteNumber) {
    const key = this.keyMap[noteNumber];
    if (!key) return this.whiteKeyWidth;
    return key.isBlack ? this.blackKeyWidth : this.whiteKeyWidth;
  }

  getNoteColor(note, isActive) {
    // Check for result coloring
    const resultKey = `${note.startTick}-${note.noteNumber}`;
    const result = this.noteResults.get(resultKey);
    if (result === 'correct') return this.colors.correct;
    if (result === 'wrong') return this.colors.wrong;
    if (result === 'missed') return this.colors.missed;

    const handColors = note.hand === 'left' ? this.colors.leftHand : this.colors.rightHand;
    return {
      fill: isActive ? handColors.active : handColors.fill,
      glow: handColors.glow
    };
  }

  render(currentTime, notes, measures, options = {}) {
    const ctx = this.ctx;
    const { showLeftHand = true, showRightHand = true } = options;

    // Clear
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.width, this.height);

    // Filter visible notes
    const visibleStart = currentTime - 0.5;
    const visibleEnd = currentTime + this.lookAhead + 1;

    const visibleNotes = notes.filter(n => {
      if (!showLeftHand && n.hand === 'left') return false;
      if (!showRightHand && n.hand === 'right') return false;
      return n.endTime >= visibleStart && n.startTime <= visibleEnd;
    });

    // Draw measure lines
    if (measures) {
      for (const m of measures) {
        if (m.startTime >= visibleStart && m.startTime <= visibleEnd) {
          const y = this.timeToY(m.startTime, currentTime);
          ctx.strokeStyle = this.colors.measureLine;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(this.width, y);
          ctx.stroke();

          // Measure number
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.font = '10px sans-serif';
          ctx.fillText(m.number, 4, y - 3);
        }
      }
    }

    // Draw falling notes
    for (const note of visibleNotes) {
      this._drawFallingNote(ctx, note, currentTime);
    }

    // Draw playback line
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.pianoY);
    ctx.lineTo(this.width, this.pianoY);
    ctx.stroke();

    // Draw piano
    this._drawPiano(ctx);
  }

  timeToY(time, currentTime) {
    const dt = time - currentTime;
    return this.pianoY - (dt * this.pixelsPerSecond);
  }

  _drawFallingNote(ctx, note, currentTime) {
    const key = this.keyMap[note.noteNumber];
    if (!key) return;

    const x = this.getKeyX(note.noteNumber);
    const w = this.getKeyWidth(note.noteNumber);

    const topY = this.timeToY(note.endTime, currentTime);
    const bottomY = this.timeToY(note.startTime, currentTime);
    const height = Math.max(4, bottomY - topY);

    // Check if the note is currently active (crossing the piano line)
    const isActive = note.startTime <= currentTime && note.endTime >= currentTime;

    const color = this.getNoteColor(note, isActive);

    // Note bar
    const margin = key.isBlack ? 1 : 1.5;
    const radius = 3;

    ctx.fillStyle = color.fill;
    ctx.globalAlpha = isActive ? 1 : 0.85;

    // Glow effect for active notes
    if (isActive && color.glow) {
      ctx.shadowColor = color.fill;
      ctx.shadowBlur = 10;
    }

    // Rounded rect
    const rx = x + margin;
    const ry = topY;
    const rw = w - margin * 2;
    const rh = height;

    ctx.beginPath();
    ctx.moveTo(rx + radius, ry);
    ctx.lineTo(rx + rw - radius, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
    ctx.lineTo(rx + rw, ry + rh - radius);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
    ctx.lineTo(rx + radius, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
    ctx.lineTo(rx, ry + radius);
    ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.globalAlpha = 1;

    // Note name label on taller notes
    if (rh > 18 && rw > 14) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = `${Math.min(10, rw * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(midiToNoteName(note.noteNumber), rx + rw / 2, ry + rh - 4);
      ctx.textAlign = 'left';
    }
  }

  _drawPiano(ctx) {
    const y = this.pianoY;
    const h = this.pianoHeight;

    // White keys first
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const key = this.keyMap[n];
      if (key.isBlack) continue;

      const x = key.whiteIndex * this.whiteKeyWidth;
      const isPressed = this.pressedKeys.has(n);
      const highlight = this.highlightedKeys.get(n);

      if (highlight) {
        ctx.fillStyle = highlight;
      } else if (isPressed) {
        ctx.fillStyle = this.colors.whiteKeyPressed;
      } else {
        ctx.fillStyle = this.colors.whiteKey;
      }

      ctx.fillRect(x, y, this.whiteKeyWidth - 1, h);

      // Border
      if (highlight) {
        ctx.strokeStyle = highlight;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, this.whiteKeyWidth - 1, h);
        // Bright top bar for visibility
        ctx.fillStyle = highlight;
        ctx.fillRect(x, y, this.whiteKeyWidth - 1, 4);
      } else {
        ctx.strokeStyle = this.colors.whiteKeyBorder;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, this.whiteKeyWidth - 1, h);
      }

      // Mark C notes
      if (n % 12 === 0) {
        const octave = Math.floor(n / 12) - 1;
        ctx.fillStyle = '#999';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`C${octave}`, x + this.whiteKeyWidth / 2, y + h - 5);
        ctx.textAlign = 'left';
      }
    }

    // Black keys on top
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const key = this.keyMap[n];
      if (!key.isBlack) continue;

      const x = this.getKeyX(n);
      const isPressed = this.pressedKeys.has(n);
      const highlight = this.highlightedKeys.get(n);

      if (highlight) {
        ctx.fillStyle = highlight;
      } else if (isPressed) {
        ctx.fillStyle = this.colors.blackKeyPressed;
      } else {
        ctx.fillStyle = this.colors.blackKey;
      }

      ctx.fillRect(x, y, this.blackKeyWidth, this.blackKeyHeight);

      // Highlight glow for black keys
      if (highlight) {
        ctx.shadowColor = highlight;
        ctx.shadowBlur = 8;
        ctx.fillStyle = highlight;
        ctx.fillRect(x + 2, y + 2, this.blackKeyWidth - 4, 4);
        ctx.shadowBlur = 0;
      }

      // Subtle gradient
      const grad = ctx.createLinearGradient(x, y, x, y + this.blackKeyHeight);
      grad.addColorStop(0, 'rgba(255,255,255,0.06)');
      grad.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, this.blackKeyWidth, this.blackKeyHeight);
    }

    // Detection gold outline overlay (drawn on top of ALL key rendering)
    ctx.save();
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const color = this.detectionHighlights.get(n);
      if (!color) continue;
      const key = this.keyMap[n];
      const x = key.isBlack ? this.getKeyX(n) : key.whiteIndex * this.whiteKeyWidth;
      const w = key.isBlack ? this.blackKeyWidth : this.whiteKeyWidth - 1;
      const h = key.isBlack ? this.blackKeyHeight : this.pianoHeight;
      // Bright fill
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(x, this.pianoY, w, h);
      ctx.globalAlpha = 1;
      // Thick stroke
      ctx.lineWidth = 6;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 18;
      ctx.strokeRect(x + 1, this.pianoY + 1, w - 2, h - 2);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
  }

  setDetectionHighlight(noteNumber, color) {
    if (color) this.detectionHighlights.set(noteNumber, color);
    else this.detectionHighlights.delete(noteNumber);
  }

  clearDetectionHighlights() {
    this.detectionHighlights.clear();
  }

  setPressed(noteNumber, pressed) {
    if (pressed) {
      this.pressedKeys.add(noteNumber);
    } else {
      this.pressedKeys.delete(noteNumber);
    }
  }

  setHighlight(noteNumber, color) {
    if (color) {
      this.highlightedKeys.set(noteNumber, color);
    } else {
      this.highlightedKeys.delete(noteNumber);
    }
  }

  clearHighlights() {
    this.highlightedKeys.clear();
  }

  setNoteResult(note, result) {
    const key = `${note.startTick}-${note.noteNumber}`;
    this.noteResults.set(key, result);
  }

  clearResults() {
    this.noteResults.clear();
  }

  // Hit test for clicking on piano keys
  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (y < this.pianoY || y > this.pianoY + this.pianoHeight) return -1;

    // Check black keys first (they're on top)
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const key = this.keyMap[n];
      if (!key.isBlack) continue;
      const kx = this.getKeyX(n);
      if (x >= kx && x <= kx + this.blackKeyWidth && y <= this.pianoY + this.blackKeyHeight) {
        return n;
      }
    }

    // Then white keys
    const whiteIdx = Math.floor(x / this.whiteKeyWidth);
    for (let n = this.firstNote; n <= this.lastNote; n++) {
      const key = this.keyMap[n];
      if (!key.isBlack && key.whiteIndex === whiteIdx) {
        return n;
      }
    }

    return -1;
  }
}
