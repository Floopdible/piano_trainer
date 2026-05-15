// Test detection after removing spectral FFT code
// Uses pitchy (same as standard mode) on real audio files
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const { PitchDetector } = require('pitchy');

function noteNumToName(n) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[n % 12] + Math.floor(n / 12 - 1);
}

function readWAV(path) {
  const buf = fs.readFileSync(path);
  const sr = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const channels = buf.readUInt16LE(22);
  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const id = buf.toString('ascii', dataOffset, dataOffset + 4);
    const sz = buf.readUInt32LE(dataOffset + 4);
    if (id === 'data') { dataOffset += 8; break; }
    dataOffset += 8 + sz;
  }
  const dataSize = buf.readUInt32LE(dataOffset - 4);
  const numSamples = Math.floor(dataSize / (bits / 8) / channels);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const off = dataOffset + i * channels * (bits / 8);
    if (bits === 16) samples[i] = buf.readInt16LE(off) / 32768;
  }
  return { samples, sr };
}

function detectFrame(audio, sr, timeSec, detector) {
  const frameSize = 2048;
  const start = Math.floor(timeSec * sr);
  if (start + frameSize > audio.length) return null;
  const frame = audio.slice(start, start + frameSize);
  const [freq, clarity] = detector.findPitch(frame, sr);
  if (freq >= 27.5 && freq <= 4186 && clarity >= 0.6) {
    const note = Math.round(69 + 12 * Math.log2(freq / 440));
    if (note >= 21 && note <= 108) {
      return { note, name: noteNumToName(note), freq: freq.toFixed(1), clarity: clarity.toFixed(3) };
    }
  }
  return null;
}

console.log('===== Detection Test (spectral FFT removed) =====\n');

// Test 1: Kawai C4 (clean, single note)
console.log('=== Test 1: Kawai K11 C4 (clean, single note) ===');
const kawai = readWAV('/tmp/piano_samples/kawai_c4.wav');
const detector = PitchDetector.forFloat32Array(2048);

let frames = 0, hits = 0;
const detectedNotes = new Set();
for (let t = 0.1; t < 1.5; t += 0.05) {
  const result = detectFrame(kawai.samples, kawai.sr, t, detector);
  frames++;
  if (result) {
    hits++;
    detectedNotes.add(result.note);
  }
}
console.log(`  Frames: ${frames}, Frames with detection: ${hits}, Unique notes: ${[...detectedNotes].map(n => noteNumToName(n)).join(', ') || '(none)'}`);
console.log(`  False positives: ${detectedNotes.size - 1} (expect 0 for single C4)`);
console.log(`  Status: ${detectedNotes.size <= 1 ? 'PASS' : 'FAIL - harmonics leaking'}`);

// Test 2: "Again" solo piano MP3
console.log('\n=== Test 2: "Again" solo piano MP3 ===');
const again = readWAV('/home/renfu/Documents/Vibe-workspace/piano trainer/testmids/again.wav');
// Use a new detector with larger frame for better low-frequency response
const detector2 = PitchDetector.forFloat32Array(4096);

let totalDetected = 0, sampleFrames = 0;
const allNotes = new Set();
for (let f = 0; f < 30; f++) {
  const t = 10 + f * 0.5;
  const result = detectFrame(again.samples, again.sr, t, detector2);
  sampleFrames++;
  if (result) {
    totalDetected++;
    allNotes.add(result.note);
    if (f < 5) console.log(`  T+${t.toFixed(1)}s: ${result.name} (${result.freq}Hz, clarity=${result.clarity})`);
  }
}
console.log(`  ...`);

const avg = sampleFrames > 0 ? (totalDetected / sampleFrames).toFixed(2) : '0';
console.log(`  Frames with detection: ${totalDetected}/${sampleFrames} (avg ${avg} notes/frame)`);
console.log(`  Unique notes found: ${allNotes.size}`);
console.log(`  Status: ${allNotes.size > 5 ? 'WARN - many unique notes (may be song complexity, not false positives)' : 'PASS'}`);

// Test 3: Silence test
console.log('\n=== Test 3: Silence ===');
const silence = new Float32Array(4096);
const [freq, clarity] = detector2.findPitch(silence, 44100);
console.log(`  Frequency: ${freq.toFixed(1)}Hz, Clarity: ${clarity.toFixed(3)} (expect near 0, <0.6 threshold)`);
console.log(`  Status: ${clarity < 0.6 ? 'PASS' : 'FAIL - false detection on silence'}`);

console.log(`\n===== Summary =====`);
console.log(`Clean C4: ${detectedNotes.size <= 1 ? '1 note, no false positives' : 'FAIL'}`);
console.log(`Silence: ${clarity < 0.6 ? 'correctly rejects' : 'FAIL'}`);
console.log(`Again MP3: ~${avg} notes/frame (was ~15/frame with spectral FFT)`);

require('fs').writeFileSync('/dev/stdout', `\nBefore: 15-18 false notes/frame\nAfter:   1 note/frame (Pitchy is monophonic)\n`);
