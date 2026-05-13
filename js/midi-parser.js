/**
 * MIDI File Parser
 * Parses standard MIDI files (format 0 and 1)
 * Extracts notes, tempo, time signatures, and detects hands
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const PC_IS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

function midiToNoteName(noteNumber) {
  const octave = Math.floor(noteNumber / 12) - 1;
  return NOTE_NAMES[noteNumber % 12] + octave;
}

function midiToFrequency(noteNumber) {
  return 440 * Math.pow(2, (noteNumber - 69) / 12);
}

function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToStaffPosition(noteNumber) {
  const pc = noteNumber % 12;
  const octave = Math.floor(noteNumber / 12) - 1;
  const diatonic = PC_TO_DIATONIC[pc];
  const diatonicPos = diatonic + 7 * octave;
  const c4Diatonic = 28; // C4 = 0 + 7*4
  return diatonicPos - c4Diatonic;
}

function midiNoteIsSharp(noteNumber) {
  return PC_IS_SHARP[noteNumber % 12];
}

class MidiParser {
  parse(arrayBuffer) {
    this.buffer = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
    this.pos = 0;

    const header = this.readHeader();
    const tracks = [];
    for (let i = 0; i < header.numTracks; i++) {
      tracks.push(this.readTrack());
    }

    const tempoMap = this.buildTempoMap(tracks);
    const timeSignatures = this.extractTimeSignatures(tracks);
    const notes = this.buildNotes(tracks, header.ticksPerBeat, tempoMap);
    const duration = this.calculateDuration(notes);
    this.detectHands(notes, tracks, header);

    // Build measure info
    const measures = this.buildMeasures(timeSignatures, header.ticksPerBeat, tempoMap, duration);

    return {
      header,
      tracks,
      notes,
      tempoMap,
      timeSignatures,
      measures,
      duration,
      ticksPerBeat: header.ticksPerBeat
    };
  }

  readHeader() {
    const id = this.readString(4);
    if (id !== 'MThd') throw new Error('Not a valid MIDI file');
    const length = this.readUint32();
    const format = this.readUint16();
    const numTracks = this.readUint16();
    const division = this.readUint16();

    let ticksPerBeat;
    if (division & 0x8000) {
      const fps = -(new Int8Array([division >> 8])[0]);
      const tpf = division & 0xFF;
      ticksPerBeat = fps * tpf;
    } else {
      ticksPerBeat = division;
    }

    return { format, numTracks, ticksPerBeat, division };
  }

  readTrack() {
    const id = this.readString(4);
    if (id !== 'MTrk') throw new Error('Expected MTrk, got ' + id);
    const length = this.readUint32();
    const endPos = this.pos + length;
    const events = [];
    let runningStatus = 0;
    let absoluteTick = 0;

    while (this.pos < endPos) {
      const deltaTime = this.readVarLen();
      absoluteTick += deltaTime;

      let statusByte = this.buffer[this.pos];

      if (statusByte < 0x80) {
        statusByte = runningStatus;
      } else {
        this.pos++;
        if (statusByte < 0xF0) {
          runningStatus = statusByte;
        }
      }

      const event = { tick: absoluteTick, deltaTime };

      if (statusByte === 0xFF) {
        const type = this.buffer[this.pos++];
        const len = this.readVarLen();
        const data = this.buffer.slice(this.pos, this.pos + len);
        this.pos += len;
        event.type = 'meta';
        event.subtype = type;
        event.data = data;

        if (type === 0x03) {
          event.trackName = new TextDecoder().decode(data);
        } else if (type === 0x51) {
          event.tempo = (data[0] << 16) | (data[1] << 8) | data[2];
          event.bpm = 60000000 / event.tempo;
        } else if (type === 0x58) {
          event.numerator = data[0];
          event.denominator = Math.pow(2, data[1]);
          event.clocksPerClick = data[2];
          event.notesPerQuarter = data[3];
        } else if (type === 0x59) {
          event.keySig = {
            sharpsFlats: data[0] > 127 ? data[0] - 256 : data[0],
            minor: data[1]
          };
        } else if (type === 0x2F) {
          event.endOfTrack = true;
        }
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        const len = this.readVarLen();
        this.pos += len;
        event.type = 'sysex';
      } else {
        const channel = statusByte & 0x0F;
        const command = statusByte & 0xF0;
        event.channel = channel;

        switch (command) {
          case 0x80:
            event.type = 'noteOff';
            event.noteNumber = this.buffer[this.pos++];
            event.velocity = this.buffer[this.pos++];
            break;
          case 0x90:
            event.noteNumber = this.buffer[this.pos++];
            event.velocity = this.buffer[this.pos++];
            event.type = event.velocity === 0 ? 'noteOff' : 'noteOn';
            break;
          case 0xA0:
            event.type = 'aftertouch';
            event.noteNumber = this.buffer[this.pos++];
            event.pressure = this.buffer[this.pos++];
            break;
          case 0xB0:
            event.type = 'controlChange';
            event.controller = this.buffer[this.pos++];
            event.value = this.buffer[this.pos++];
            break;
          case 0xC0:
            event.type = 'programChange';
            event.program = this.buffer[this.pos++];
            break;
          case 0xD0:
            event.type = 'channelAftertouch';
            event.pressure = this.buffer[this.pos++];
            break;
          case 0xE0:
            event.type = 'pitchBend';
            event.value = this.buffer[this.pos++] | (this.buffer[this.pos++] << 7);
            break;
          default:
            event.type = 'unknown';
            // Try to skip gracefully
            if (this.pos < endPos) this.pos++;
            break;
        }
      }
      events.push(event);
    }

    // Ensure we're at the right position
    this.pos = endPos;

    const nameEvent = events.find(e => e.trackName);
    return { events, name: nameEvent ? nameEvent.trackName : null };
  }

  buildTempoMap(tracks) {
    const tempoEvents = [];
    for (const track of tracks) {
      for (const event of track.events) {
        if (event.tempo) {
          tempoEvents.push({
            tick: event.tick,
            microsecondsPerBeat: event.tempo,
            bpm: event.bpm
          });
        }
      }
    }
    tempoEvents.sort((a, b) => a.tick - b.tick);
    if (tempoEvents.length === 0) {
      tempoEvents.push({ tick: 0, microsecondsPerBeat: 500000, bpm: 120 });
    }
    return tempoEvents;
  }

  extractTimeSignatures(tracks) {
    const timeSigs = [];
    for (const track of tracks) {
      for (const event of track.events) {
        if (event.numerator !== undefined) {
          timeSigs.push({
            tick: event.tick,
            numerator: event.numerator,
            denominator: event.denominator
          });
        }
      }
    }
    timeSigs.sort((a, b) => a.tick - b.tick);
    if (timeSigs.length === 0) {
      timeSigs.push({ tick: 0, numerator: 4, denominator: 4 });
    }
    return timeSigs;
  }

  tickToTime(tick, ticksPerBeat, tempoMap) {
    let time = 0;
    let lastTick = 0;
    let usPerBeat = tempoMap[0].microsecondsPerBeat;

    for (const tempoEvent of tempoMap) {
      if (tempoEvent.tick >= tick) break;
      time += ((tempoEvent.tick - lastTick) / ticksPerBeat) * (usPerBeat / 1000000);
      lastTick = tempoEvent.tick;
      usPerBeat = tempoEvent.microsecondsPerBeat;
    }

    time += ((tick - lastTick) / ticksPerBeat) * (usPerBeat / 1000000);
    return time;
  }

  timeToTick(time, ticksPerBeat, tempoMap) {
    let currentTime = 0;
    let lastTick = 0;
    let usPerBeat = tempoMap[0].microsecondsPerBeat;

    for (let i = 0; i < tempoMap.length; i++) {
      const evt = tempoMap[i];
      if (evt.tick > 0) {
        const segTime = ((evt.tick - lastTick) / ticksPerBeat) * (usPerBeat / 1000000);
        if (currentTime + segTime >= time) {
          break;
        }
        currentTime += segTime;
        lastTick = evt.tick;
      }
      usPerBeat = evt.microsecondsPerBeat;
    }

    const remainingTime = time - currentTime;
    return lastTick + (remainingTime / (usPerBeat / 1000000)) * ticksPerBeat;
  }

  buildNotes(tracks, ticksPerBeat, tempoMap) {
    const notes = [];

    tracks.forEach((track, trackIndex) => {
      const activeNotes = {};

      for (const event of track.events) {
        if (event.type === 'noteOn') {
          const key = `${event.channel}-${event.noteNumber}`;
          // If there's already an active note with this key, close it first
          if (activeNotes[key]) {
            const note = activeNotes[key];
            note.endTick = event.tick;
            note.endTime = this.tickToTime(event.tick, ticksPerBeat, tempoMap);
            note.duration = note.endTime - note.startTime;
            note.durationTicks = note.endTick - note.startTick;
            if (note.duration > 0.01) notes.push(note);
          }
          activeNotes[key] = {
            track: trackIndex,
            channel: event.channel,
            noteNumber: event.noteNumber,
            velocity: event.velocity,
            startTick: event.tick,
            startTime: this.tickToTime(event.tick, ticksPerBeat, tempoMap)
          };
        } else if (event.type === 'noteOff') {
          const key = `${event.channel}-${event.noteNumber}`;
          if (activeNotes[key]) {
            const note = activeNotes[key];
            note.endTick = event.tick;
            note.endTime = this.tickToTime(event.tick, ticksPerBeat, tempoMap);
            note.duration = note.endTime - note.startTime;
            note.durationTicks = note.endTick - note.startTick;
            if (note.duration > 0.005) notes.push(note);
            delete activeNotes[key];
          }
        }
      }

      // Close remaining notes
      for (const key in activeNotes) {
        const note = activeNotes[key];
        const lastEvent = track.events[track.events.length - 1];
        note.endTick = lastEvent ? lastEvent.tick : note.startTick + ticksPerBeat;
        note.endTime = this.tickToTime(note.endTick, ticksPerBeat, tempoMap);
        note.duration = note.endTime - note.startTime;
        note.durationTicks = note.endTick - note.startTick;
        if (note.duration > 0.005) notes.push(note);
      }
    });

    notes.sort((a, b) => a.startTime - b.startTime || a.noteNumber - b.noteNumber);
    return notes;
  }

  detectHands(notes, tracks, header) {
    if (header.format === 1 && tracks.length >= 2) {
      const noteTracks = [];
      tracks.forEach((track, idx) => {
        const hasNotes = track.events.some(e => e.type === 'noteOn');
        if (hasNotes) noteTracks.push(idx);
      });

      if (noteTracks.length >= 2) {
        const trackAvgPitch = {};
        for (const ti of noteTracks) {
          const trackNotes = notes.filter(n => n.track === ti);
          if (trackNotes.length > 0) {
            trackAvgPitch[ti] = trackNotes.reduce((s, n) => s + n.noteNumber, 0) / trackNotes.length;
          }
        }

        const sortedTracks = Object.entries(trackAvgPitch).sort(([, a], [, b]) => b - a);

        if (sortedTracks.length >= 2) {
          const rightTrack = parseInt(sortedTracks[0][0]);
          const leftTrack = parseInt(sortedTracks[1][0]);

          for (const note of notes) {
            if (note.track === rightTrack) note.hand = 'right';
            else if (note.track === leftTrack) note.hand = 'left';
            else note.hand = note.noteNumber >= 60 ? 'right' : 'left';
          }
          return;
        }
      }
    }

    // Fallback: split by middle C
    for (const note of notes) {
      note.hand = note.noteNumber >= 60 ? 'right' : 'left';
    }
  }

  buildMeasures(timeSignatures, ticksPerBeat, tempoMap, duration) {
    const measures = [];
    let tick = 0;
    let measureNum = 1;
    let tsIdx = 0;
    let num = timeSignatures[0].numerator;
    let den = timeSignatures[0].denominator;
    const maxTick = this.timeToTick(duration + 1, ticksPerBeat, tempoMap);

    while (tick < maxTick) {
      // Check for time signature change
      while (tsIdx < timeSignatures.length - 1 && timeSignatures[tsIdx + 1].tick <= tick) {
        tsIdx++;
        num = timeSignatures[tsIdx].numerator;
        den = timeSignatures[tsIdx].denominator;
      }

      const ticksPerMeasure = ticksPerBeat * num * (4 / den);
      const startTime = this.tickToTime(tick, ticksPerBeat, tempoMap);
      const endTick = tick + ticksPerMeasure;
      const endTime = this.tickToTime(endTick, ticksPerBeat, tempoMap);

      measures.push({
        number: measureNum,
        startTick: tick,
        endTick: endTick,
        startTime,
        endTime,
        numerator: num,
        denominator: den
      });

      tick = endTick;
      measureNum++;

      if (measureNum > 5000) break; // Safety
    }

    return measures;
  }

  calculateDuration(notes) {
    if (notes.length === 0) return 0;
    return Math.max(...notes.map(n => n.endTime));
  }

  readUint32() {
    const val = this.view.getUint32(this.pos);
    this.pos += 4;
    return val;
  }

  readUint16() {
    const val = this.view.getUint16(this.pos);
    this.pos += 2;
    return val;
  }

  readString(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(this.buffer[this.pos++]);
    }
    return s;
  }

  readVarLen() {
    let value = 0;
    let byte;
    let count = 0;
    do {
      byte = this.buffer[this.pos++];
      value = (value << 7) | (byte & 0x7F);
      count++;
      if (count > 4) break; // Safety
    } while (byte & 0x80);
    return value;
  }
}
