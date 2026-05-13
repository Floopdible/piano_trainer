/**
 * Standalone clef rendering test — run with Node to generate test PNGs
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../screenshot/clef-test.png');
const W = 400, H = 300;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#fefefe';
ctx.fillRect(0, 0, W, H);

const sp = 10;
const leftMargin = 60;

// Draw staff lines
ctx.strokeStyle = '#999';
ctx.lineWidth = 0.8;
const trebleY = 80;
const bassY = 180;
for (let staff of [trebleY, bassY]) {
  for (let i = -2; i <= 2; i++) {
    const y = staff + i * sp;
    ctx.beginPath();
    ctx.moveTo(leftMargin - 10, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

// Draw brace between staves
const topY = trebleY - 2 * sp;
const bottomY = bassY + 2 * sp;
const x = leftMargin - 14;
ctx.strokeStyle = '#666';
ctx.lineWidth = 2.5;
ctx.beginPath();
const midY = (topY + bottomY) / 2;
ctx.moveTo(x, topY);
ctx.bezierCurveTo(x - 8, topY + (midY - topY) * 0.3, x - 8, midY - 10, x - 2, midY);
ctx.bezierCurveTo(x - 8, midY + 10, x - 8, midY + (bottomY - midY) * 0.7, x, bottomY);
ctx.stroke();

// Draw treble clef at G line (trebleY + sp)
function drawTrebleClef(ctx, cx, cy, sp) {
  const x = cx + sp * 0.2;
  const y = cy; // G line
  const s = sp * 1.3;
  ctx.lineWidth = sp * 0.2;
  ctx.strokeStyle = '#333';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Vertical stroke
  ctx.beginPath();
  ctx.moveTo(x, y - s * 3.8);
  ctx.lineTo(x, y + s * 3.5);
  ctx.stroke();

  // Main spiral loop
  ctx.beginPath();
  ctx.moveTo(x, y - s * 2.5);
  ctx.bezierCurveTo(x + s * 1.8, y - s * 2.8, x + s * 1.8, y + s * 0.3, x, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 1.2, y + s * 0.3, x - s * 1.2, y - s * 1.5, x, y - s * 1.5);
  ctx.stroke();

  // Upper curl
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.5);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 2.0, x + s * 0.4, y - s * 2.6, x - s * 0.2, y - s * 2.5);
  ctx.stroke();

  // Bottom curl
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y + s * 1.0, x - s * 0.3, y + s * 1.8, x + s * 0.1, y + s * 2.2);
  ctx.bezierCurveTo(x + s * 0.3, y + s * 2.6, x, y + s * 3.0, x - s * 0.2, y + s * 2.8);
  ctx.stroke();

  // Crossing arc near G line
  ctx.beginPath();
  ctx.moveTo(x + s * 0.3, y - s * 0.5);
  ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.1, x + s * 0.3, y + s * 0.4);
  ctx.stroke();
}

// Draw bass clef at F line (bassY - sp)
function drawBassClef(ctx, cx, cy, sp) {
  const x = cx + sp * 0.3;
  const y = cy; // F line
  const s = sp * 1.1;
  ctx.lineWidth = sp * 0.22;
  ctx.strokeStyle = '#333';
  ctx.fillStyle = '#333';

  // C-like curve
  ctx.beginPath();
  ctx.moveTo(x + s * 0.3, y - s * 1.5);
  ctx.bezierCurveTo(x - s * 0.6, y - s * 1.8, x - s * 0.8, y + s * 1.8, x + s * 0.3, y + s * 1.5);
  ctx.stroke();

  // Two dots
  ctx.beginPath();
  ctx.arc(x + s * 0.9, y - s * 0.55, sp * 0.22, 0, Math.PI * 2);
  ctx.arc(x + s * 0.9, y + s * 0.55, sp * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

// Draw notehead test
function drawNotehead(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.75, r * 1.05, 0.25, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a test notehead with stem
function drawNoteWithStem(ctx, x, y, r, sp, stemUp, fill) {
  drawNotehead(ctx, x, y, r, fill);
  const stemX = stemUp ? x + r * 0.78 : x - r * 0.78;
  const stemY = stemUp ? y - r * 0.95 : y + r * 0.95;
  const stemEnd = stemUp ? stemY - sp * 3.5 : stemY + sp * 3.5;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(stemX, stemY);
  ctx.lineTo(stemX, stemEnd);
  ctx.stroke();
}

// Draw clefs
drawTrebleClef(ctx, leftMargin - 2, trebleY + sp, sp);
drawBassClef(ctx, leftMargin - 2, bassY - sp, sp);

// Draw some test notes
drawNoteWithStem(ctx, 150, trebleY + sp, sp * 0.45, sp, true, '#222');
drawNoteWithStem(ctx, 200, trebleY - sp, sp * 0.45, sp, false, '#222');
drawNoteWithStem(ctx, 250, bassY - sp, sp * 0.45, sp, true, '#222');
drawNoteWithStem(ctx, 300, bassY + sp * 2, sp * 0.45, sp, false, '#222');

// Save
const buf = canvas.toBuffer('image/png');
fs.writeFileSync(OUT, buf);
console.log('Clef test saved to', OUT);
