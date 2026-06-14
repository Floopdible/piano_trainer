# Piano Trainer

Mic-based piano practice app with MIDI playback, sheet music rendering, and real-time multi-note detection.

![Logo](../logo-pianovex.svg)

## Features

- **MIDI playback** — load any `.mid` file with separate left/right hands, playback controls (play/pause/stop/loop), tempo slider, and per-hand mute/solo
- **Sheet music** — VexFlow-based renderer with dynamic clefs, key signatures, accidentals, triplets, and 8va brackets. Auto-pages through measures as MIDI plays
- **Real-time pitch detection** — 4 detection modes:
  - **Standard** — Pitchy autocorrelation, fast and lightweight
  - **Basic Pitch** — Spotify's Basic Pitch (TensorFlow.js), ~80% F1
  - **Transkun** — Transformer-based piano transcription (ONNX), ~94% F1
  - **Kong** — CNN piano transcription (ONNX), ~90% F1
- **Noise cancellation** — Spectral subtraction (DFT), DeepFilterNet3 (AudioWorklet), or browser Chrome NS
- **Calibration** — measures A4 from your microphone to compensate for piano tuning drift
- **Recording comparison** — records 10s of mic audio and compares Raw, Spectral-denoised, and DeepFilterNet3-denoised versions
- **Multi-keyboard display** — real-time piano roll with detected notes highlighted
- **Drag-and-drop MIDI** — drop MIDI files anywhere on the page

## Quick Start

```bash
npm install
node server.js
# Open http://localhost:8080
```

Enable microphone when prompted, then drag in a MIDI file and click play.

## Detection Modes

| Mode | Library | F1 Score | Load Time |
|---|---|---|---|
| Standard | Pitchy | ~70% | Instant |
| Basic Pitch | TensorFlow.js | ~80% | ~5s |
| Transkun | ONNX (WebAssembly) | ~94% | ~5s |
| Kong | ONNX (WebAssembly) | ~90% | ~8s |

All four modes detect multiple simultaneous notes. Standard mode loads instantly and is best for quick practice. Transkun and Kong offer accuracy closer to professional piano transcription.

## Model Files

Large model files are loaded from the server at runtime:

| File | Size | Used By |
|---|---|---|
| `models/kong.onnx` | 95 MB | Kong mode |
| `models/transkun.onnx` + `.data` | 52 MB | Transkun mode |
| `models/deepfilternet3/v2/...` | 17 MB | DeepFilterNet3 noise cancellation |

### Deploying to Netlify

The code deploys to Netlify as a static site. The large ONNX model files (95 MB + 52 MB) exceed Netlify's drag-and-drop limit but work with **Git-based deploys** since Netlify has no per-file size limit for static assets via Git.

**Option 1: Push everything to Git**
```bash
git add .
git commit -m "..."
git push
```
Netlify will clone the repo and deploy. Model files are included in the deploy.

**Option 2: Gitignore + separate upload** (smaller repo)
1. Add to `.gitignore`:
   ```
   models/kong.onnx
   models/transkun.onnx
   models/transkun.onnx.data
   ```
2. Push code only
3. Upload the excluded model files via the Netlify CLI:
   ```bash
   npx netlify deploy --dir=. --upload-file-mapping "models/kong.onnx=models/kong.onnx" --upload-file-mapping "models/transkun.onnx=models/transkun.onnx" --upload-file-mapping "models/transkun.onnx.data=models/transkun.onnx.data"
   ```
4. Set empty build command, publish directory `piano_trainer/`

The model files are cached effectively — set cache headers to 1 year in `netlify.toml` or `_headers`.

## Project Structure

```
piano_trainer/
├── index.html          — main app page
├── css/style.css       — layout and styling
├── js/
│   ├── app.js          — UI, MIDI playback, recording
│   ├── pitch-detector.js — all 4 detection modes, noise cancellation
│   ├── midi-parser.js  — MIDI file parser
│   └── transkun-decoder.js — CRF decoder for Transkun model
├── models/             — ONNX models + DeepFilterNet3 assets
├── favicon-*.png       — favicon at 16/32/48/64/128/192/256/512px
├── scripts/            — ONNX export scripts (PyTorch)
└── server.js           — local dev server with MIME types
```

## Browser Support

Chrome, Firefox, Edge, Safari (14.5+).
