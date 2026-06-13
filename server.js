const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

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
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.onnx': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.data': 'application/octet-stream',
  '.ico': 'image/x-icon'
};

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

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Press Ctrl+C to stop`);
});
