import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8080';
const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const page = await browser.newPage();
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE_ERROR] ${err.message}`));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
console.log('Page loaded');

// Enable mic and wait
await page.click('#btn-mic');
await new Promise(r => setTimeout(r, 3000));

// Check DF3 state immediately after mic
const s1 = await page.evaluate(() => {
  const pc = window.PianoTrainer?.pitchDetector;
  return { df: pc?._df ? 'loaded' : 'null', dfReady: pc?._dfReady };
});
console.log('After mic:', JSON.stringify(s1));

// Check for the class name
const hasClass = await page.evaluate(() => typeof SpectralSubtractor !== 'undefined');
console.log('SpectralSubtractor global:', hasClass);

await browser.close();
