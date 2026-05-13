/**
 * Screenshot script - captures sheet music rendering from test MIDI
 * Usage: node screenshot-sheet.js
 */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const ROOT = path.join(__dirname, '.');
const SCREENSHOT_DIR = path.join(__dirname, '../screenshot');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Start HTTP server
const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url));
  if (filePath.endsWith('/')) filePath += 'index.html';

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + req.url);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

async function takeScreenshots() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Server running at http://localhost:${PORT}/`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  // Set viewport to a reasonable size
  await page.setViewport({ width: 1280, height: 900 });

  // Navigate to the app
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  console.log('Page loaded');

  // Wait for JS to initialize
  await page.waitForFunction(() => typeof window.app !== 'undefined', { timeout: 5000 });
  console.log('App initialized');

  // Load the test MIDI file via fetch and inject programmatically
  const midiPath = path.join(__dirname, '../testmids/Again_(Your_Lie_in_April).mid');
  const midiBuffer = fs.readFileSync(midiPath);
  const base64 = midiBuffer.toString('base64');
  const fileName = path.basename(midiPath);

  await page.evaluate((base64Data, fileName) => {
    return new Promise((resolve, reject) => {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const file = new File([bytes], fileName, { type: 'audio/midi' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const input = document.getElementById('midi-file-input');
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve();
    });
  }, base64, fileName);
  console.log('MIDI file injected');

  // Wait for MIDI to parse and render
  await page.waitForFunction(() => {
    return window.app && window.app.midiData && window.app.midiData.notes.length > 0;
  }, { timeout: 10000 });
  console.log('MIDI parsed:', await page.evaluate(() => window.app.midiData.notes.length + ' notes'));

  // Wait a bit for rendering to settle
  await new Promise(r => setTimeout(r, 500));

  // Take full page screenshot
  const fullPagePath = path.join(SCREENSHOT_DIR, 'sheet-music-fullpage.png');
  await page.screenshot({ path: fullPagePath, fullPage: false });
  console.log('Full page screenshot saved to', fullPagePath);

  // Take screenshot of the sheet canvas specifically
  const sheetCanvas = await page.$('#sheet-canvas');
  if (sheetCanvas) {
    const sheetPath = path.join(SCREENSHOT_DIR, 'sheet-music-canvas.png');
    await sheetCanvas.screenshot({ path: sheetPath });
    console.log('Sheet canvas screenshot saved to', sheetPath);
  }

  // Take screenshot of the waterfall canvas
  const waterfallCanvas = await page.$('#waterfall-canvas');
  if (waterfallCanvas) {
    const waterfallPath = path.join(SCREENSHOT_DIR, 'waterfall-canvas.png');
    await waterfallCanvas.screenshot({ path: waterfallPath });
    console.log('Waterfall canvas screenshot saved to', waterfallPath);
  }

  // Take screenshots at multiple points in the piece
  const timePoints = [0, 5, 15, 30, 45, 60, 90, 120];
  for (const t of timePoints) {
    await page.evaluate((time) => { window.app._seek(time); }, t);
    await new Promise(r => setTimeout(r, 300));
    const tpPath = path.join(SCREENSHOT_DIR, `sheet-music-t${t}.png`);
    await page.screenshot({ path: tpPath, fullPage: false });
    console.log(`Screenshot at ${t}s saved to`, tpPath);
  }

  await browser.close();
  server.close();
  console.log('\nAll screenshots saved to', SCREENSHOT_DIR);
}

takeScreenshots().catch(err => {
  console.error('Screenshot failed:', err);
  server.close();
  process.exit(1);
});
