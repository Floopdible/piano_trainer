import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8080';
const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const page = await browser.newPage();
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') 
    console.log(`[${msg.type()}] ${msg.text()}`);
});
page.on('response', resp => {
  if (resp.status() >= 400)
    console.log(`  HTTP ${resp.status()}: ${resp.url().substring(0, 120)}`);
});

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
console.log('Page loaded, enabling mic...');

const initialState = await page.evaluate(() => {
  const app = document.querySelector('#app');
  return { appExists: !!app, hasPianoTrainer: typeof PianoTrainer !== 'undefined' };
});
console.log('Initial state:', JSON.stringify(initialState));

await page.click('#btn-mic');
await new Promise(r => setTimeout(r, 5000));

const state = await page.evaluate(() => {
  const pc = window.PianoTrainer?.pitchDetector;
  return {
    pianoTrainerExists: typeof PianoTrainer !== 'undefined',
    pcExists: !!pc,
    df: pc?._df ? 'loaded' : 'null',
    dfNode: pc?._dfNode ? 'exists' : 'null',
    dfReady: pc?._dfReady,
    mode: pc?._mode,
    noiseCancel: pc?._noiseCancel,
    micActive: document.getElementById('btn-mic')?.classList.contains('active')
  };
});
console.log('After mic state:', JSON.stringify(state, null, 2));

await browser.close();
