// Transkun decoder - CRF Viterbi + post-processing
// Ported from https://github.com/Yujia-Yan/Transkun

class TranskunDecoder {
  constructor(config) {
    this.fs = config.fs || 44100;
    this.hopSize = config.hopSize || 1024;
    this.targetMIDIPitch = config.targetMIDIPitch || [];
    this.nSymbols = this.targetMIDIPitch.length;
  }

  // Viterbi backward decode (port of @torch.jit.script viterbiBackward)
  decode(score, noiseScore, forcedStartPos) {
    // score: [T, T, nBatch], noiseScore: [T-1, nBatch]
    const T = score.length;
    const nBatch = score[0][0].length;
    const ptr = [];
    const q = new Array(T);
    for (let i = 0; i < T; i++) q[i] = new Array(nBatch).fill(-Infinity);

    // Last frame
    for (let b = 0; b < nBatch; b++) {
      q[T - 1][b] = score[T - 1][T - 1][b] > 0 ? score[T - 1][T - 1][b] : 0;
    }

    for (let i = 1; i < T; i++) {
      const ti = T - i - 1;
      const sel = new Array(nBatch).fill(-1);
      const maxV = new Array(nBatch).fill(-Infinity);

      for (let b = 0; b < nBatch; b++) {
        // skip option
        const skipVal = q[ti + 1][b] + (noiseScore[ti] ? noiseScore[ti][b] : 0);
        let best = -1;
        let bestVal = skipVal;

        // interval option
        for (let k = ti + 1; k < T; k++) {
          const val = q[k][b] + score[k][ti][b];
          if (val > bestVal) { bestVal = val; best = k - ti - 1; }
        }
        sel[b] = best;
        maxV[b] = bestVal;
      }

      ptr.push(sel);

      for (let b = 0; b < nBatch; b++) {
        const diagVal = score[ti][ti][b] > 0 ? score[ti][ti][b] : 0;
        q[ti][b] = maxV[b] + diagVal;
      }
    }

    // Backtrack
    const diagInclusion = [];
    for (let b = 0; b < nBatch; b++) {
      const d = [];
      for (let t = 0; t < T; t++) d.push(score[t][t][b] > 0);
      diagInclusion.push(d);
    }

    if (!forcedStartPos) forcedStartPos = new Array(nBatch).fill(0);

    const result = [];
    for (let b = 0; b < nBatch; b++) {
      let j = forcedStartPos[b];
      const cur = [];
      while (j < T - 1) {
        if (diagInclusion[b][j]) cur.push([j, j]);
        const sel = ptr[T - j - 2][b];
        if (sel < 0) {
          j++;
        } else {
          const i = sel + j + 1;
          cur.push([j, i]);
          j = i;
        }
      }
      if (diagInclusion[b][T - 1]) cur.push([T - 1, T - 1]);
      result.push(cur);
    }
    return result;
  }

  // Convert decoded intervals to note events
  intervalsToNotes(intervals, segmentBeginTime, segmentHopFrames) {
    const notes = [];
    const midiLookup = [...this.targetMIDIPitch];

    for (let symIdx = 0; symIdx < intervals.length; symIdx++) {
      const pitch = midiLookup[symIdx];
      if (pitch < 21 || pitch > 108) continue; // Skip special symbols

      for (const [startFrame, endFrame] of intervals[symIdx]) {
        const startTime = segmentBeginTime + (startFrame * this.hopSize) / this.fs;
        const endTime = segmentBeginTime + ((endFrame + 1) * this.hopSize) / this.fs;
        notes.push({
          pitch,
          startTime,
          endTime,
          velocity: 80, // Default velocity
        });
      }
    }
    return notes;
  }

  // Merge overlapping/same-pitch notes across segments
  mergeNotes(notes) {
    if (notes.length === 0) return [];
    const byPitch = new Map();
    for (const n of notes) {
      if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
      byPitch.get(n.pitch).push(n);
    }

    const result = [];
    for (const [pitch, pitchNotes] of byPitch) {
      pitchNotes.sort((a, b) => a.startTime - b.startTime);
      let cur = pitchNotes[0];
      for (let i = 1; i < pitchNotes.length; i++) {
        const n = pitchNotes[i];
        if (n.startTime <= cur.endTime + 0.05) {
          // Merge overlapping/consecutive notes of same pitch
          cur.endTime = Math.max(cur.endTime, n.endTime);
        } else {
          result.push(cur);
          cur = n;
        }
      }
      result.push(cur);
    }
    return result.sort((a, b) => a.startTime - b.startTime);
  }
}
