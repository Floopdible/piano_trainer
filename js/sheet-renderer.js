/**
 * Sheet Music Renderer - VexFlow-based implementation
 * Displays a single system (grand staff) that pages horizontally during playback
 */
class SheetMusicRenderer {
  constructor(container) {
    this.container = container;
    this.highlightedNotes = new Map();
    this.noteElements = new Map();
    this.scoreData = null;
    this.svg = null;
    this.measurePositions = [];
    this.currentPage = -1;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.container.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.container.style.width = this.width + 'px';
    this.container.style.height = this.height + 'px';
    if (this.scoreData) {
      this._prepareScore(this.scoreData.notes, this.scoreData.measures, this.scoreData.midiData);
      const currentTick = this.scoreData.currentTick || 0;
      const pageIndex = this._getPageForTick(currentTick);
      this._renderPage(pageIndex, this.scoreData.options || {});
    }
  }

  setScrollY(delta) {
    // No vertical scrolling in single-system view
  }

  render(currentTime, notes, measures, midiData, options = {}) {
    const { showLeftHand = true, showRightHand = true } = options;

    if (!midiData || !notes || notes.length === 0) {
      this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-family:sans-serif;">Load a MIDI file to see sheet music</div>';
      return;
    }

    const isNewData = !this.scoreData || this.scoreData.notes !== notes;
    if (isNewData) {
      this.scoreData = { notes, measures, midiData, options };
      this._prepareScore(notes, measures, midiData);
      this.currentPage = -1;
    } else {
      this.scoreData.options = options;
    }

    const currentTick = this._timeToTick(currentTime, midiData);
    this.scoreData.currentTick = currentTick;

    const pageIndex = this._getPageForTick(currentTick);
    if (pageIndex !== this.currentPage || isNewData) {
      this.currentPage = pageIndex;
      this._renderPage(pageIndex, options);
    }

    this._updateHighlights(currentTick);
    this._updateCursor(currentTick);
  }

  _chooseClef(notes, hand, prevClef) {
    if (notes.length === 0) return prevClef;
    const pitches = notes.map(n => n.noteNumber);

    if (hand === 'right') {
      if (Math.max(...pitches) < 55) return 'bass';
      return 'treble';
    }

    const avg = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const trebleDist = Math.abs(avg - 71);
    const bassDist = Math.abs(avg - 50);

    if (trebleDist < bassDist * 0.7) return 'treble';
    if (bassDist < trebleDist * 0.7) return 'bass';
    return prevClef;
  }

  _chooseOctaveShift(notes, clef) {
    if (notes.length === 0) return 0;
    const max = Math.max(...notes.map(n => n.noteNumber));
    const min = Math.min(...notes.map(n => n.noteNumber));
    if (clef === 'treble' && max >= 88) return -1; // 8va
    if (clef === 'bass' && min <= 36) return 1;    // 8vb
    return 0;
  }

  _prepareScore(notes, measures, midiData) {
    const VF = Vex.Flow;
    const keySig = this._getKeySignature(midiData);
    const keySigStr = this._keySigToVexFlow(keySig);
    const useFlats = keySig.sharpsFlats < 0;
    const ticksPerBeat = midiData.ticksPerBeat || 480;
    const timeSig = midiData.timeSignatures && midiData.timeSignatures.length > 0
      ? midiData.timeSignatures[0]
      : { numerator: 4, denominator: 4 };

    const notesByMeasure = [];
    for (let i = 0; i < measures.length; i++) {
      notesByMeasure.push({ right: [], left: [] });
    }
    for (const note of notes) {
      const mIdx = this._findMeasureIndex(note.startTick, measures);
      if (mIdx >= 0 && mIdx < notesByMeasure.length) {
        notesByMeasure[mIdx][note.hand].push(note);
      }
    }

    const hasRight = notes.some(n => n.hand === 'right');
    const hasLeft = notes.some(n => n.hand === 'left');

    const rightNotes = notes.filter(n => n.hand === 'right');
    const leftNotes = notes.filter(n => n.hand === 'left');
    const rightAvg = rightNotes.length > 0
      ? rightNotes.reduce((s, n) => s + n.noteNumber, 0) / rightNotes.length
      : 72;
    const leftAvg = leftNotes.length > 0
      ? leftNotes.reduce((s, n) => s + n.noteNumber, 0) / leftNotes.length
      : 48;

    const clefByMeasure = { right: [], left: [] };
    const octaveShiftByMeasure = { right: [], left: [] };
    let prevClef = {
      right: rightAvg >= 60 ? 'treble' : 'bass',
      left: leftAvg >= 48 ? 'treble' : 'bass'
    };

    for (let i = 0; i < measures.length; i++) {
      for (const hand of ['right', 'left']) {
        const handNotes = notesByMeasure[i][hand];
        const clef = this._chooseClef(handNotes, hand, prevClef[hand]);
        clefByMeasure[hand].push(clef);
        const shift = this._chooseOctaveShift(handNotes, clef);
        octaveShiftByMeasure[hand].push(shift);
        prevClef[hand] = clef;
      }
    }

    const measureWidths = [];
    for (let i = 0; i < measures.length; i++) {
      const rightNotesVF = this._createVFNotes(
        notesByMeasure[i].right, clefByMeasure.right[i], useFlats, ticksPerBeat, keySigStr, octaveShiftByMeasure.right[i]
      );
      const leftNotesVF = this._createVFNotes(
        notesByMeasure[i].left, clefByMeasure.left[i], useFlats, ticksPerBeat, keySigStr, octaveShiftByMeasure.left[i]
      );

      let minWidth = 100;
      const m = measures[i];
      const numBeats = m.numerator || timeSig.numerator || 4;
      const beatValue = m.denominator || timeSig.denominator || 4;

      if (rightNotesVF.length > 0 || leftNotesVF.length > 0) {
        const voice1 = new VF.Voice({ num_beats: numBeats, beat_value: beatValue });
        voice1.setStrict(false);
        if (rightNotesVF.length > 0) voice1.addTickables(rightNotesVF);
        else voice1.addTickables([new VF.GhostNote({ duration: 'q' })]);

        const voice2 = new VF.Voice({ num_beats: numBeats, beat_value: beatValue });
        voice2.setStrict(false);
        if (leftNotesVF.length > 0) voice2.addTickables(leftNotesVF);
        else voice2.addTickables([new VF.GhostNote({ duration: 'q' })]);

        const formatter = new VF.Formatter();
        formatter.joinVoices([voice1, voice2]);
        minWidth = formatter.preCalculateMinTotalWidth([voice1, voice2]) + 80;
      }

      if (i === 0) minWidth += 110;

      if (i > 0) {
        if (clefByMeasure.right[i] !== clefByMeasure.right[i - 1]) minWidth += 40;
        if (clefByMeasure.left[i] !== clefByMeasure.left[i - 1]) minWidth += 40;
      }

      measureWidths.push(Math.max(minWidth, 120));
    }

    const systemMarginX = 15;
    const systemWidth = this.width - systemMarginX * 2;
    const pages = [];
    let currentPage = [];
    let currentWidth = 0;

    for (let i = 0; i < measures.length; i++) {
      const w = measureWidths[i];
      if (w > systemWidth && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [i];
        currentWidth = w;
      } else if (currentWidth + w > systemWidth && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [i];
        currentWidth = w;
      } else {
        currentPage.push(i);
        currentWidth += w;
      }
    }
    if (currentPage.length > 0) pages.push(currentPage);

    this.scoreData.notesByMeasure = notesByMeasure;
    this.scoreData.measureWidths = measureWidths;
    this.scoreData.pages = pages;
    this.scoreData.keySigStr = keySigStr;
    this.scoreData.useFlats = useFlats;
    this.scoreData.ticksPerBeat = ticksPerBeat;
    this.scoreData.timeSig = timeSig;
    this.scoreData.hasRight = hasRight;
    this.scoreData.hasLeft = hasLeft;
    this.scoreData.clefByMeasure = clefByMeasure;
    this.scoreData.octaveShiftByMeasure = octaveShiftByMeasure;
  }

  _getPageForTick(tick) {
    const { pages, measures } = this.scoreData;
    if (!pages || pages.length === 0) return 0;

    for (let p = 0; p < pages.length; p++) {
      const pageMeasures = pages[p];
      const startTick = measures[pageMeasures[0]].startTick;
      const endTick = measures[pageMeasures[pageMeasures.length - 1]].endTick;
      if (tick >= startTick && tick < endTick) return p;
    }

    if (tick < measures[pages[0][0]].startTick) return 0;
    return pages.length - 1;
  }

  _renderPage(pageIndex, options = {}) {
    const { showLeftHand = true, showRightHand = true } = options;
    this.container.innerHTML = '';
    this.noteElements.clear();
    this.measurePositions = [];

    if (!this.scoreData || !this.scoreData.pages || this.scoreData.pages.length === 0) {
      this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-family:sans-serif;">No measures to display</div>';
      return;
    }

    if (pageIndex < 0 || pageIndex >= this.scoreData.pages.length) pageIndex = 0;

    const VF = Vex.Flow;
    const {
      measures, notesByMeasure, measureWidths, keySigStr,
      useFlats, ticksPerBeat, timeSig, hasRight, hasLeft,
      clefByMeasure, octaveShiftByMeasure
    } = this.scoreData;
    const pageMeasures = this.scoreData.pages[pageIndex];

    const renderTreble = showRightHand && hasRight;
    const renderBass = showLeftHand && hasLeft;
    const numStaves = (renderTreble ? 1 : 0) + (renderBass ? 1 : 0);

    if (numStaves === 0) {
      this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-family:sans-serif;">No notes for selected hand</div>';
      return;
    }

    const systemMarginX = 15;
    const availableWidth = this.width - systemMarginX * 2;
    const totalMinWidth = pageMeasures.reduce((sum, idx) => sum + measureWidths[idx], 0);
    const scale = totalMinWidth > availableWidth ? availableWidth / totalMinWidth : 1;

    let requiredGap = 0;
    if (renderTreble && renderBass) {
      let topLowestPos = 0;
      let botHighestPos = 0;
      for (const mi of pageMeasures) {
        for (const n of notesByMeasure[mi].right) {
          const p = (n.noteNumber - 71) * 5;
          if (p < topLowestPos) topLowestPos = p;
        }
        const lc = clefByMeasure.left[mi];
        const center = lc === 'bass' ? 50 : 71;
        for (const n of notesByMeasure[mi].left) {
          const p = (n.noteNumber - center) * 5;
          if (p > botHighestPos) botHighestPos = p;
        }
      }
      const topExtent = Math.abs(topLowestPos);
      const botExtent = Math.abs(botHighestPos);
      requiredGap = 80 + topExtent + botExtent + 20;
    }
    const staffSpacing = renderTreble && renderBass
      ? Math.max(80, Math.min(this.height * 0.48, requiredGap))
      : 0;
    const systemHeight = renderTreble && renderBass ? staffSpacing + 100 : 100;

    const renderer = new VF.Renderer(this.container, VF.Renderer.Backends.SVG);
    renderer.resize(this.width, this.height);
    const context = renderer.getContext();
    this.svg = this.container.querySelector('svg');
    if (this.svg) {
      this.svg.style.transition = 'none';
    }

    let y = Math.max(10, (this.height - systemHeight) / 2);
    if (!renderTreble && renderBass) {
      y = Math.max(10, (this.height - 90) / 2);
    }

    let x = systemMarginX;

    for (let mi = 0; mi < pageMeasures.length; mi++) {
      const i = pageMeasures[mi];
      const m = measures[i];
      const width = measureWidths[i] * scale;
      const isFirstSystemMeasure = mi === 0;

      const rightClef = clefByMeasure.right[i];
      const leftClef = clefByMeasure.left[i];
      const rightShift = octaveShiftByMeasure.right[i];
      const leftShift = octaveShiftByMeasure.left[i];

      let trebleStave = null;
      let bassStave = null;
      let rightStartPassage = false;
      let leftStartPassage = false;

      if (renderTreble) {
        trebleStave = new VF.Stave(x, y, width);
        if (isFirstSystemMeasure) {
          trebleStave.addClef(rightClef);
          trebleStave.addKeySignature(keySigStr);
          if (pageIndex === 0) {
            trebleStave.addTimeSignature(timeSig.numerator + '/' + timeSig.denominator);
          }
          trebleStave.setMeasure(m.number);
        } else if (rightClef !== clefByMeasure.right[pageMeasures[mi - 1]]) {
          trebleStave.addClef(rightClef);
        }
        trebleStave.setContext(context).draw();

        rightStartPassage = rightShift !== 0 && (mi === 0 || 
          octaveShiftByMeasure.right[pageMeasures[mi - 1]] !== rightShift);
      }

      if (renderBass) {
        bassStave = new VF.Stave(x, y + staffSpacing, width);
        if (isFirstSystemMeasure) {
          bassStave.addClef(leftClef);
          bassStave.addKeySignature(keySigStr);
          if (pageIndex === 0) {
            bassStave.addTimeSignature(timeSig.numerator + '/' + timeSig.denominator);
          }
        } else if (leftClef !== clefByMeasure.left[pageMeasures[mi - 1]]) {
          bassStave.addClef(leftClef);
        }
        bassStave.setContext(context).draw();

        leftStartPassage = leftShift !== 0 && (mi === 0 || 
          octaveShiftByMeasure.left[pageMeasures[mi - 1]] !== leftShift);
      }

      if (renderTreble && renderBass) {
        if (isFirstSystemMeasure) {
          const brace = new VF.StaveConnector(trebleStave, bassStave);
          brace.setType(VF.StaveConnector.type.BRACE);
          brace.setContext(context).draw();

          const leftLine = new VF.StaveConnector(trebleStave, bassStave);
          leftLine.setType(VF.StaveConnector.type.SINGLE_LEFT);
          leftLine.setContext(context).draw();
        }
        const rightLine = new VF.StaveConnector(trebleStave, bassStave);
        rightLine.setType(VF.StaveConnector.type.SINGLE_RIGHT);
        rightLine.setContext(context).draw();
      }

      if (renderTreble) {
        const rightNotes = this._createVFNotes(
          notesByMeasure[i].right, rightClef, useFlats, ticksPerBeat, keySigStr, rightShift
        );
        this._drawVoice(context, trebleStave, rightNotes, ticksPerBeat, 'right', m.numerator, m.denominator, rightShift, rightStartPassage);
      }
      if (renderBass) {
        const leftNotes = this._createVFNotes(
          notesByMeasure[i].left, leftClef, useFlats, ticksPerBeat, keySigStr, leftShift
        );
        this._drawVoice(context, bassStave, leftNotes, ticksPerBeat, 'left', m.numerator, m.denominator, leftShift, leftStartPassage);
      }

      this.measurePositions.push({
        x, y, width,
        startTick: m.startTick,
        endTick: m.endTick
      });

      x += width;
    }

    if (this.scoreData.currentTick !== undefined) {
      this._updateHighlights(this.scoreData.currentTick);
    }
  }

  _drawVoice(context, stave, vfNotes, ticksPerBeat, hand, numerator = 4, denominator = 4, octaveShift = 0, isFirstInPassage = false) {
    const VF = Vex.Flow;
    if (vfNotes.length === 0) {
      const rest = new VF.StaveNote({ clef: stave.clef, keys: ['b/4'], duration: 'wr' });
      const voice = new VF.Voice({ num_beats: numerator, beat_value: denominator });
      voice.setStrict(false);
      voice.addTickables([rest]);
      const formatter = new VF.Formatter();
      formatter.joinVoices([voice]);
      formatter.formatToStave([voice], stave);
      voice.draw(context, stave);
      return;
    }

    vfNotes.sort((a, b) => a.noteData.startTick - b.noteData.startTick);

    const tuplets = [];
    let i = 0;
    while (i < vfNotes.length) {
      if (vfNotes[i].noteData && vfNotes[i].noteData.isTriplet) {
        const dur = vfNotes[i].noteData.duration;
        let j = i;
        while (j < vfNotes.length && vfNotes[j].noteData &&
               vfNotes[j].noteData.isTriplet &&
               vfNotes[j].noteData.duration === dur) {
          j++;
        }
        const count = j - i;
        for (let k = 0; k + 3 <= count; k += 3) {
          tuplets.push(new VF.Tuplet(vfNotes.slice(i + k, i + k + 3), {
            num_notes: 3, notes_occupied: 2
          }));
        }
        i = j;
      } else {
        i++;
      }
    }

    const beams = VF.Beam.generateBeams(vfNotes, {
      beam_rests: false, maintain_stem_directions: false
    });

    const voice = new VF.Voice({ num_beats: numerator, beat_value: denominator });
    voice.setStrict(false);
    voice.addTickables(vfNotes);

    const formatter = new VF.Formatter();
    formatter.joinVoices([voice]);
    formatter.formatToStave([voice], stave);

    voice.draw(context, stave);
    beams.forEach(beam => beam.setContext(context).draw());
    tuplets.forEach(t => t.setContext(context).draw());

    if (octaveShift !== 0 && isFirstInPassage && vfNotes.length > 0) {
      const superscript = octaveShift === -1 ? 'va' : 'vb';
      const position = octaveShift === -1
        ? VF.TextBracket.Positions.TOP
        : VF.TextBracket.Positions.BOTTOM;
      try {
        const tb = new VF.TextBracket({
          start: vfNotes[0],
          stop: vfNotes[vfNotes.length - 1],
          text: '8', superscript, position
        });
        tb.setContext(context).draw();
      } catch (e) {}
    }

    for (const note of vfNotes) {
      if (note.noteData) {
        const el = document.getElementById(note.noteData.id);
        if (el) {
          this.noteElements.set(note.noteData.key, {
            element: el,
            color: hand === 'right' ? '#4a7aff' : '#ff6a4a',
            hand,
            notes: note.noteData.notes
          });
        }
      }
    }
  }

  _getKeySignatureAccidentals(keySigStr) {
    const map = new Map();
    if (!keySigStr || keySigStr === 'C' || keySigStr === 'Am') return map;

    const flatOrder = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
    const sharpOrder = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
    const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
    const sharpKeys = ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

    const flatIdx = flatKeys.indexOf(keySigStr);
    const sharpIdx = sharpKeys.indexOf(keySigStr);

    if (flatIdx >= 0) {
      for (let i = 0; i <= flatIdx; i++) map.set(flatOrder[i], 'b');
    } else if (sharpIdx >= 0) {
      for (let i = 0; i <= sharpIdx; i++) map.set(sharpOrder[i], '#');
    }
    return map;
  }

  _createVFNotes(notes, clef, useFlats, ticksPerBeat, keySigStr, octaveShift = 0) {
    const VF = Vex.Flow;
    const chords = new Map();
    for (const note of notes) {
      const key = note.startTick;
      if (!chords.has(key)) chords.set(key, []);
      chords.get(key).push(note);
    }

    const keySigAccidentals = this._getKeySignatureAccidentals(keySigStr);
    const vfNotes = [];
    const sortedTicks = Array.from(chords.keys()).sort((a, b) => a - b);

    for (let ci = 0; ci < sortedTicks.length; ci++) {
      const startTick = sortedTicks[ci];
      const chordNotes = chords.get(startTick);
      const seen = new Set();
      const unique = [];
      for (const n of chordNotes) {
        if (!seen.has(n.noteNumber)) {
          seen.add(n.noteNumber);
          unique.push(n);
        }
      }
      const maxRawDur = Math.max(...unique.map(n => n.durationTicks));
      const nextTick = ci < sortedTicks.length - 1 ? sortedTicks[ci + 1] : startTick + maxRawDur;
      const effectiveDur = Math.min(maxRawDur, nextTick - startTick);
      const durInfo = this._getVFDuration(effectiveDur, ticksPerBeat);
      const duration = durInfo.val;
      const isTriplet = durInfo.isTriplet;

      const rawKeys = unique.map(n => ({
        key: this._midiToVexFlowKey(n.noteNumber, useFlats, octaveShift),
        note: n
      }));

      const keySeen = new Set();
      const keys = [];
      const noteMap = [];
      for (const entry of rawKeys) {
        if (!keySeen.has(entry.key)) {
          keySeen.add(entry.key);
          keys.push(entry.key);
          noteMap.push(entry.note);
        }
      }

      const staveNote = new VF.StaveNote({ clef, keys, duration, auto_stem: true });

      const noteId = `note-${startTick}-${chordNotes[0].noteNumber}`;
      staveNote.setAttribute('id', noteId);

      staveNote.noteData = {
        id: noteId,
        key: `${startTick}-${chordNotes[0].noteNumber}`,
        startTick,
        endTick: Math.max(...chordNotes.map(n => n.endTick)),
        hand: chordNotes[0].hand,
        notes: chordNotes,
        duration,
        isTriplet
      };

      keys.forEach((key, idx) => {
        const pitchPart = key.split('/')[0];
        const letter = pitchPart[0];
        const acc = pitchPart.slice(1);
        const impliedAcc = keySigAccidentals.get(letter) || '';

        if (acc !== impliedAcc) {
          staveNote.addModifier(new VF.Accidental(acc === '' ? 'n' : acc), idx);
        }
      });

      vfNotes.push(staveNote);
    }

    vfNotes.sort((a, b) => a.noteData.startTick - b.noteData.startTick);
    return vfNotes;
  }

  _midiToVexFlowKey(noteNumber, useFlats, octaveShift = 0) {
    const octave = Math.floor(noteNumber / 12) - 1 + octaveShift;
    const pc = noteNumber % 12;
    const sharpNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
    const flatNames = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
    const name = useFlats ? flatNames[pc] : sharpNames[pc];
    return `${name}/${octave}`;
  }

  _getVFDuration(durationTicks, ticksPerBeat) {
    const beats = durationTicks / ticksPerBeat;

    const triplets = [
      { beats: 1.333, val: 'h' },
      { beats: 0.666, val: 'q' },
      { beats: 0.333, val: '8' },
      { beats: 0.166, val: '16' },
    ];

    const durations = [
      { beats: 4.0, val: 'w' },
      { beats: 3.0, val: 'hd' },
      { beats: 2.0, val: 'h' },
      { beats: 1.5, val: 'qd' },
      { beats: 1.0, val: 'q' },
      { beats: 0.75, val: '8d' },
      { beats: 0.5, val: '8' },
      { beats: 0.375, val: '16d' },
      { beats: 0.25, val: '16' },
      { beats: 0.1875, val: '32d' },
      { beats: 0.125, val: '32' }
    ];

    for (const d of triplets) {
      if (Math.abs(beats - d.beats) < d.beats * 0.04) {
        return { val: d.val, isTriplet: true };
      }
    }

    for (const d of durations) {
      if (Math.abs(beats - d.beats) < Math.max(0.03, d.beats * 0.06)) {
        return { val: d.val, isTriplet: false };
      }
    }

    let best = durations[0];
    let bestDiff = Math.abs(beats - best.beats);
    for (const d of durations) {
      const diff = Math.abs(beats - d.beats);
      if (diff < bestDiff) {
        best = d;
        bestDiff = diff;
      }
    }
    return { val: best.val, isTriplet: false };
  }

  _getKeySignature(midiData) {
    for (const track of midiData.tracks) {
      for (const ev of track.events) {
        if (ev.keySig) return ev.keySig;
      }
    }
    return { sharpsFlats: 0, minor: 0 };
  }

  _keySigToVexFlow(keySig) {
    if (!keySig || keySig.sharpsFlats === 0) return 'C';
    const sharps = keySig.sharpsFlats;
    const sharpKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
    const flatKeys = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
    const idx = Math.min(Math.abs(sharps), 7);
    return sharps > 0 ? sharpKeys[idx] : flatKeys[idx];
  }

  _findMeasureIndex(tick, measures) {
    for (let i = 0; i < measures.length; i++) {
      if (tick >= measures[i].startTick && tick < measures[i].endTick) return i;
    }
    if (measures.length > 0 && tick >= measures[measures.length - 1].endTick) {
      return measures.length - 1;
    }
    return -1;
  }

  _timeToTick(time, midiData) {
    let currentTime = 0, lastTick = 0;
    let usPerBeat = midiData.tempoMap[0].microsecondsPerBeat;
    const tpb = midiData.ticksPerBeat;
    for (const evt of midiData.tempoMap) {
      if (evt.tick > 0) {
        const segTime = ((evt.tick - lastTick) / tpb) * (usPerBeat / 1000000);
        if (currentTime + segTime >= time) break;
        currentTime += segTime;
        lastTick = evt.tick;
      }
      usPerBeat = evt.microsecondsPerBeat;
    }
    return lastTick + ((time - currentTime) / (usPerBeat / 1000000)) * tpb;
  }

  _updateHighlights(currentTick) {
    for (const [key, data] of this.noteElements) {
      const { element, color, hand, notes } = data;
      const result = this.highlightedNotes.get(key);

      let fillColor = color;
      const isPlaying = notes.some(n => n.startTick <= currentTick && n.endTick >= currentTick);
      const isPast = notes.every(n => n.endTick < currentTick);

      if (result === 'correct') fillColor = '#4CAF50';
      else if (result === 'missed') fillColor = '#FF9800';
      else if (result === 'wrong') fillColor = '#f44336';
      else if (isPlaying) fillColor = hand === 'right' ? '#4a7aff' : '#ff6a4a';
      else if (isPast) fillColor = '#bbb';

      const noteheads = element.querySelectorAll('.vf-notehead');
      for (const nh of noteheads) { nh.style.fill = fillColor; nh.style.stroke = fillColor; }
      const stems = element.querySelectorAll('.vf-stem, .vf-flag, .vf-beam');
      for (const stem of stems) { stem.style.fill = fillColor; stem.style.stroke = fillColor; }
    }
  }

  _updateCursor(currentTick) {
    let currentMeasure = null;
    for (const mp of this.measurePositions) {
      if (currentTick >= mp.startTick && currentTick < mp.endTick) {
        currentMeasure = mp; break;
      }
    }
    if (!currentMeasure) return;

    let cursor = this.container.querySelector('.sheet-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'sheet-cursor';
      cursor.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:rgba(74,122,255,0.5);pointer-events:none;z-index:10;';
      this.container.appendChild(cursor);
    }

    const measureProgress = (currentTick - currentMeasure.startTick) / (currentMeasure.endTick - currentMeasure.startTick);
    cursor.style.left = (currentMeasure.x + measureProgress * currentMeasure.width) + 'px';
    cursor.style.top = '5px';
    cursor.style.height = (this.height - 10) + 'px';
  }

  setNoteResult(note, result) {
    this.highlightedNotes.set(`${note.startTick}-${note.noteNumber}`, result);
  }

  clearResults() {
    this.highlightedNotes.clear();
  }
}
