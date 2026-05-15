import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8080';
const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const page = await browser.newPage();
page.on('console', msg => {
  // Only log warnings and errors
  if (msg.type() === 'warning' || msg.type() === 'error')
    console.log(`[${msg.type()}] ${msg.text().substring(0, 250)}`);
});
page.on('response', resp => {
  const url = resp.url();
  if (resp.status() >= 400 || url.includes('deepfilter') || url.includes('df_bg'))
    console.log(`  ${resp.status()} ${url.substring(0, 120)}`);
});

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
console.log('Page loaded');

// Enable mic
await page.click('#btn-mic');
await new Promise(r => setTimeout(r, 5000));

// Check DF3 via the global app
const state = await page.evaluate(() => {
  const pc = window.app?.pitchDetector;
  return {
    appExists: !!window.app,
    pcExists: !!pc,
    df: pc?._df ? 'loaded' : 'null',
    dfNode: pc?._dfNode ? 'exists' : 'null',
    mode: pc?._mode,
    noiseCancel: pc?._noiseCancel
  };
});
console.log('State:', JSON.stringify(state, null, 2));

await browser.close();
