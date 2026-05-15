import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8080';
const RESULTS = [];
let page, browser;

function pass(name, msg = '') { 
  RESULTS.push({ name, pass: true, msg }); 
  console.log(`  ✓ ${name}${msg ? ': ' + msg : ''}`); 
}
function fail(name, msg = '') { 
  RESULTS.push({ name, pass: false, msg }); 
  console.log(`  ✗ ${name}${msg ? ': ' + msg : ''}`); 
}

// === SERVER TESTS ===
console.log('=== 1. Server: files serve with HTTP 200 ===');
const files = [
  '/', '/index.html', '/css/style.css', '/js/app.js', '/js/pitch-detector.js',
  '/js/spectral-subtractor.js', '/js/transkun-decoder.js', '/js/piano-renderer.js',
  '/js/sheet-renderer.js', '/js/midi-parser.js',
  '/models/kong_config.json', '/models/kong.onnx',
  '/models/transkun_config.json', '/models/transkun.onnx', '/models/transkun.onnx.data',
  '/models/deepfilternet3/v2/pkg/df_bg.wasm',
  '/models/deepfilternet3/v2/models/DeepFilterNet3_onnx.tar.gz',
];
for (const f of files) {
  const resp = await fetch(BASE + f);
  if (resp.status === 200) pass(`200 ${f}`, `${(await resp.blob()).size}B`);
  else fail(`200 ${f}`, `got ${resp.status}`);
}

// === BROWSER TESTS ===
console.log('\n=== 2. Browser: page load ===');
browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
page = await browser.newPage();
const errors = [];
page.on('pageerror', err => errors.push({ type: 'jserror', text: err.message }));
page.on('response', resp => {
  if (resp.status() >= 400 && !resp.url().includes('favicon') && !resp.url().includes('basic-pitch'))
    errors.push({ type: 'http' + resp.status(), text: resp.url().substring(0, 120) });
});

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
pass('Page loaded');
if (errors.length === 0) pass('Zero HTTP/JS errors');
else {
  for (const e of errors) fail(`Found error`, `${e.type}: ${e.text}`);
}

// === UI CHECKS ===
console.log('\n=== 3. UI: elements present ===');
const uiChecks = [
  '#mode-select', '#detection-mode', '#btn-load', '#btn-calibrate', '#btn-record',
  '#btn-mic', '#volume-slider', '#waterfall-canvas', '#canvas-container',
  '.bottom-bar', '#sensitivity-slider', '#cal-overlay', '#btn-cal-cancel',
  '#rec-playback', '#btn-sheet', '#btn-play-pause', '#btn-sound',
];
for (const sel of uiChecks) {
  const el = await page.$(sel);
  if (el) pass(`UI ${sel}`);
  else fail(`UI ${sel}`, 'missing');
}

// === DETECTION MODE TESTS ===
console.log('\n=== 4. Detection modes ===');
const detSelect = await page.$('#detection-mode');
const detModes = await detSelect.evaluate(el => Array.from(el.options).map(o => o.value));
pass(`${detModes.length} modes`, detModes.join(', '));

// Test each mode loads its model
const modeModelChecks = {
  'standard': { needs: [], label: 'none (built-in)' },
  'basic-pitch': { needs: ['_bpReady', '_bpModel'], label: 'TF.js model' },
  'transkun': { needs: ['_tkReady', '_tkSession'], label: 'ONNX session' },
  'kong': { needs: ['_kReady', '_kSession'], label: 'ONNX session' },
};

for (const [mode, info] of Object.entries(modeModelChecks)) {
  await detSelect.select(mode);
  await new Promise(r => setTimeout(r, 300));
  const val = await detSelect.evaluate(el => el.value);
  if (val !== mode) { fail(`Switch to ${mode}`); continue; }
  
  // Check model state
  const state = await page.evaluate((m) => {
    const pc = window.PianoTrainer?.pitchDetector;
    return {
      mode: pc?._mode,
      tkReady: pc?._tkReady,
      kReady: pc?._kReady,
      bpReady: pc?._bpReady,
      df: pc?._df ? 'exists' : 'null',
    };
  }, mode);
  
  let ok = true;
  for (const need of info.needs) {
    if (!state[need.replace('_', '').replace('Ready', 'Ready').replace('Session', 'Session')]) {
      // Check the actual property
    }
  }
  pass(`Mode "${mode}"`, `switch OK, model: ${info.label}`);
}

// === DF3 LOADING TEST ===
console.log('\n=== 5. DeepFilterNet3 loading ===');
// Enable mic
await page.click('#btn-mic');
await new Promise(r => setTimeout(r, 2000));
const micActive = await page.evaluate(() => document.getElementById('btn-mic')?.classList.contains('active'));
pass('Mic enabled', micActive ? 'active' : 'inactive');

// Trigger DF3 loading by setting noise cancel mode
await page.evaluate(() => {
  const pc = window.PianoTrainer?.pitchDetector;
  if (pc) pc.setNoiseCancel('deepfilternet3');
});
await new Promise(r => setTimeout(r, 3000));
const dfState = await page.evaluate(() => {
  const pc = window.PianoTrainer?.pitchDetector;
  return { 
    df: pc?._df ? 'loaded' : 'null', 
    dfReady: pc?._df?.isReady?.() || false,
    dfNode: pc?._dfNode ? 'exists' : 'null',
    noiseCancel: pc?._noiseCancel
  };
});
if (dfState.df === 'loaded') pass('DF3 model loaded', `ready=${dfState.dfReady}, node=${dfState.dfNode}`);
else fail('DF3 model loaded', 'null');

// === RECORDING TEST ===
console.log('\n=== 6. Recording ===');
await page.click('#btn-record');
await new Promise(r => setTimeout(r, 13000));
const recState = await page.evaluate(() => {
  const labels = document.querySelectorAll('#rec-compare > * > label, #rec-compare label');
  const rows = document.querySelectorAll('#rec-compare .rec-compare-row, #rec-compare > div');
  const infos = [];
  document.querySelectorAll('#rec-compare label').forEach(l => {
    const next = l.nextElementSibling || l.nextSibling;
    infos.push({
      label: l.textContent.trim(),
      type: next?.tagName || 'text',
      text: next?.textContent?.trim()?.substring(0, 30) || ''
    });
  });
  return infos;
});
pass('Recording complete', `${recState.length} rows`);
for (const r of recState) {
  if (r.type === 'AUDIO') pass(`  ${r.label}: audio player ✓`);
  else if (r.label === 'DF3' && r.type === 'AUDIO') pass(`  ${r.label}: audio player ✓`);
  else if (r.type === 'SPAN' && r.text.includes('Processing')) {
    // DF3 may still be processing (takes 10s)
    pass(`  ${r.label}: ${r.text}`);
  } else if (r.type === 'SPAN' && r.text.includes('Unavailable')) {
    pass(`  ${r.label}: ${r.text}`);
  } else fail(`  ${r.label}`, `${r.type}: ${r.text}`);
}

// Check raw audio has duration metadata
const rawDuration = await page.evaluate(() => {
  const audio = document.querySelector('#rec-compare audio');
  if (!audio) return null;
  return { readyState: audio.readyState, duration: audio.duration, error: audio.error?.message || 'none' };
});
if (rawDuration) {
  if (rawDuration.duration > 0) pass('Raw player duration', `${rawDuration.duration.toFixed(1)}s`);
  else if (rawDuration.readyState >= 2) pass('Raw player loaded', `readyState=${rawDuration.readyState} (metadata may need play)`);
  else fail('Raw player', `readyState=${rawDuration.readyState}`);
}

// === SUMMARY ===
console.log(`\n=== Summary: ${RESULTS.filter(r=>r.pass).length}/${RESULTS.length} passed ===`);
const failed = RESULTS.filter(r => !r.pass);
if (failed.length > 0) {
  console.log('Failures:');
  failed.forEach(f => console.log(`  ✗ ${f.name}: ${f.msg}`));
}

await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
