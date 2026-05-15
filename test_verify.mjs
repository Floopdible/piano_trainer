// Verify no spectral FFT false positives remain
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const buf = require('fs').readFileSync('/home/renfu/Documents/Vibe-workspace/piano trainer/piano_trainer/js/pitch-detector.js', 'utf8');

const checks = [
  ['_detectSpectral', buf.includes('_detectSpectral')],
  ['_trackMultiNotes', buf.includes('_trackMultiNotes')],
  ['_freqBuffer', buf.includes('_freqBuffer')],
  ['_multiNotes', buf.includes('_multiNotes')],
  ['_minPeakDB', buf.includes('_minPeakDB')],
];

let allClean = true;
for (const [name, found] of checks) {
  console.log(found ? 'FAIL: ' + name + ' still present' : 'PASS: ' + name + ' removed');
  if (found) allClean = false;
}

// Count remaining key methods
const methods = ['_detectPitchy', '_runBasicPitch', '_processBasicPitch', '_trackNote', '_noteOn', '_noteOff'];
console.log('\nRemaining detection methods:');
for (const m of methods) {
  const count = buf.split(m).length - 1;
  console.log('  ' + m + ': ' + count + ' reference(s)');
}

console.log('\n' + (allClean ? 'All spectral FFT code removed. Detection is clean.' : 'Spectral FFT code still present!'));
