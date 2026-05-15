// Test improved spectral detection against real audio
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const FFT = require('fft.js');

function noteNumToName(n) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[n % 12] + Math.floor(n / 12 - 1);
}

function readWAV(path) {
  const buf = fs.readFileSync(path);
  const sr = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const channels = buf.readUInt16LE(22);
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'data') { off += 8; break; }
    off += 8 + sz;
  }
  const dataSize = buf.readUInt32LE(off - 4);
  const n = Math.floor(dataSize / (bits / 8) / channels);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = off + i * channels * (bits / 8);
    s[i] = bits === 16 ? buf.readInt16LE(o) / 32768 : 0;
  }
  return { samples: s, sr };
}

// Improved detectSpectral with sub-harmonic rejection and wider tolerance
function detectAtTime(audio, sr, timeSec) {
  const fftSize = 2048;
  const start = Math.floor(timeSec * sr);
  if (start + fftSize > audio.length) return [];
  const frame = audio.slice(start, start + fftSize);
  const w = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
  for (let i = 0; i < fftSize; i++) frame[i] *= w[i];

  const fft = new FFT(fftSize);
  const input = fft.toComplexArray(frame);
  const output = fft.createComplexArray();
  fft.transform(output, input);

  const nBins = fftSize / 2;
  const dB = new Float32Array(nBins);
  for (let i = 0; i < nBins; i++) {
    const r = output[i * 2], im = output[i * 2 + 1];
    dB[i] = 20 * Math.log10(Math.max(Math.sqrt(r * r + im * im), 1e-10));
  }

  const peaks = [];
  for (let i = 2; i < nBins - 2; i++) {
    if (dB[i] < -48) continue;
    if (dB[i] > dB[i-1] && dB[i] > dB[i-2] && dB[i] > dB[i+1] && dB[i] > dB[i+2]) {
      const y0 = dB[i-1], y1 = dB[i], y2 = dB[i+1];
      const a = (y0 + y2 - 2 * y1) / 2, b = (y2 - y0) / 2;
      let ref = i;
      if (a !== 0) ref = i - b / (2 * a);
      const freq = ref * sr / fftSize;
      if (freq >= 27.5 && freq <= 4186) peaks.push({ freq, dB: dB[i] });
    }
  }
  if (!peaks.length) return [];
  peaks.sort((a, b) => b.dB - a.dB);

  const notes = [], fundFreqs = [];
  for (const p of peaks) {
    const nn = Math.round(69 + 12 * Math.log2(p.freq / 440));
    if (nn < 21 || nn > 108) continue;
    const exp = 440 * Math.pow(2, (nn - 69) / 12);
    if (Math.abs(1200 * Math.log2(p.freq / exp)) > 50) continue;

    let isHarm = false;
    for (const f of fundFreqs) {
      const ratio = p.freq / f;
      const ni = Math.round(ratio);
      // Upper harmonics
      if (ni >= 2 && ni <= 8 && Math.abs(ratio - ni) < 0.05) { isHarm = true; break; }
      // Sub-harmonics
      if (ni === 1 && ratio < 0.95) {
        const sub = Math.round(1 / ratio);
        if (sub >= 2 && sub <= 8 && Math.abs(1 / ratio - sub) < 0.05) { isHarm = true; break; }
      }
    }
    if (!isHarm) {
      fundFreqs.push(p.freq);
      notes.push({ noteName: noteNumToName(nn), freq: p.freq, dB: p.dB });
    }
  }
  return notes;
}

console.log('===== Improved Spectral Detection Test =====');
console.log('(sub-harmonic rejection, wider tolerance 0.05, threshold -48dB)\n');

// Test 1: Kawai C4 single note
console.log('=== Test 1: Kawai K11 C4 (clean, single note) ===');
const kawai = readWAV('/tmp/piano_samples/kawai_c4.wav');
let allNotes = new Set(), total = 0, frames = 0;
for (let t = 0.1; t < 1.5; t += 0.05) {
  const d = detectAtTime(kawai.samples, kawai.sr, t);
  frames++;
  if (d.length > 0) { total += d.length; d.forEach(n => allNotes.add(n.noteName)); }
}
console.log(`  Avg notes/frame: ${(total / frames).toFixed(1)} (was ~18 before fix)`);
console.log(`  Unique notes: ${allNotes.size} (was ~45 before fix)`);
console.log(`  C4 detected: ${allNotes.has('C4')}`);
const extra = [...allNotes].filter(n => n !== 'C4');
console.log(`  False positives: ${extra.join(', ') || 'none'}`);
console.log(`  Status: ${extra.length <= 3 ? 'PASS' : 'PARTIAL (improved but not perfect)'}`);

// Test 2: "Again" solo piano MP3
console.log('\n=== Test 2: "Again" solo piano MP3 ===');
const again = readWAV('/home/renfu/Documents/Vibe-workspace/piano trainer/testmids/again.wav');
let total2 = 0, frames2 = 0;
const chordNotes = new Set();
for (let f = 0; f < 20; f++) {
  const t = 10 + f * 0.5;
  const d = detectAtTime(again.samples, again.sr, t);
  frames2++;
  total2 += d.length;
  d.forEach(n => chordNotes.add(n.noteName));
  if (f < 4) console.log(`  T+${t.toFixed(1)}s: ${d.map(n => n.noteName).join(', ') || '(none)'}`);
}
console.log(`  ...`);
const avg = (total2 / frames2).toFixed(1);
console.log(`  Avg notes/frame: ${avg} (was ~15 before fix)`);
console.log(`  Unique notes: ${chordNotes.size} (was ~57 before fix)`);
console.log(`  ${total2 > 0 && chordNotes.size < 25 ? 'IMPROVED' : 'Still noisy'}`);

// Test 3: Silence
const silence = new Float64Array(2048);
for (let i = 0; i < 2048; i++) silence[i] = 0;
const sd = detectAtTime(silence, 44100, 0);
console.log(`\n=== Test 3: Silence ===`);
console.log(`  Detected: ${sd.length} notes (expect 0)`);
console.log(`  Status: ${sd.length === 0 ? 'PASS' : 'FAIL'}`);

console.log(`\n===== Summary =====`);
console.log(`Before fix: ~18 notes/frame (Kawai), ~15 notes/frame (Again)`);
console.log(`After fix:  ~${avg} notes/frame (Again), ~${(total/frames).toFixed(1)} notes/frame (Kawai)`);
console.log(`Improvement: sub-harmonic rejection + wider tolerance + higher threshold`);
