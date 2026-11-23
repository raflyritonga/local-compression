# Local Compress

Compress PNG, JPG/JPEG and PDF files from a web page on your own computer. The server listens on `127.0.0.1` only, keeps everything in memory, and never stores or sends your files anywhere.

## Run it

Requires Python 3.10 or newer.

```bash
./run.sh
```

The first run creates `.venv/` and installs dependencies, then opens http://127.0.0.1:8765 in your browser. Press `Ctrl+C` to stop.

Options:

```bash
./run.sh --port 9000      # use another port
./run.sh --no-browser     # don't open a tab automatically
```

On Windows, run the same steps by hand:

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
```

## Using it

1. Set **Compression strength** (1–100%). Lower keeps more quality, higher makes smaller files.
2. Drop files onto the page or click to browse. Each file shows its new size and the percentage saved.
3. Move the slider again at any time and every file is recompressed at the new level.
4. **Save** writes one file, **Save all** writes every file. Saved files get a `-compressed` suffix so originals are never overwritten.

Choosing where to save: Chrome, Edge, Brave and Arc open a native "Save as" / folder picker. Safari and Firefox save through their normal download flow (Save all becomes a `.zip`); turn on "Ask where to save each file" in the browser settings to pick a folder every time.

## What the strength slider does

| Format | How it's compressed | 1% | 50% | 100% |
| --- | --- | --- | --- | --- |
| JPG / JPEG | Re-encoded with optimized, progressive JPEG | quality 94 | quality 52 | quality 10 |
| PNG | Lossless up to 10%, then palette quantization with dithering (libimagequant) | lossless | 75 colors | 16 colors |
| PDF | Images downsampled and re-encoded as JPEG, fonts subset, unused objects removed | 298 dpi, q94 | 186 dpi, q52 | 72 dpi, q10 |

Notes:

- If compression would make a file bigger, the original is returned unchanged ("Already optimal").
- JPEG metadata (EXIF, GPS location) is removed; orientation, color profile and DPI are kept.
- Animated PNGs and password-protected PDFs are left as they are.
- Text and vector graphics in PDFs are not touched, so text-only PDFs shrink less than scanned or image-heavy ones.

## Project layout

```
app.py               Flask app and local server (waitress)
compressor/
  __init__.py        Detects the file type and dispatches
  levels.py          Maps the 1–100 level to encoder settings
  images.py          JPEG and PNG compression (Pillow, imagequant)
  pdf.py             PDF compression (PyMuPDF)
  errors.py          User-facing error type
static/              The web interface (plain HTML, CSS, JS; no external requests)
```

To tune how aggressive each level is, edit `compressor/levels.py`.
