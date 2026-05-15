import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8080';
const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const page = await browser.newPage();
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });

// Enable mic and wait
await page.click('#btn-mic');
await new Promise(r => setTimeout(r, 4000));

// Filter for DF3/deepfilter related logs
console.log('=== DF3-related logs ===');
logs.filter(l => l.toLowerCase().includes('deepfilter') || l.toLowerCase().includes('df3') || l.toLowerCase().includes('wasm') || l.toLowerCase().includes('webassembly'))
  .forEach(l => console.log(l));

if (!logs.some(l => l.toLowerCase().includes('deepfilter'))) {
  console.log('No DF3 logs found. All console output:');
  logs.forEach(l => console.log(l));
}

await browser.close();
