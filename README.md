# qrdrop-web

Browser-based QRDrop/QRA1 sender and receiver.

It is the web equivalent of `qrdrop-cli`: choose a local file, scan one setup QR, then stream animated data QR frames. It also includes a receiver tab that uses the phone/browser camera to scan QRDrop streams and reconstruct files. All file processing happens client-side in the browser; selected files and camera frames are never uploaded and are not embedded in the URL.

Settings are mirrored into the URL hash (`#chunkSize=...&fps=...`) so a hosted/static copy can preserve sender settings without server-side state.

## Use from GitHub Pages / any static host

This app can run directly as static files. It does not require a backend.

For GitHub Pages:

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Set **Source** to `Deploy from a branch`.
4. Choose the `main` branch and `/ (root)` folder.
5. Open the published Pages URL.

The checked-in `index.html` uses relative paths, so it works from project pages such as:

```text
https://dcbz.github.io/qrdrop-web/
```

## Run locally

No build is required; any static server works:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080
```

For Vite development:

```bash
npm install
npm run dev
```

Open the printed local URL.

Sender flow: choose a file, press **Prepare**, scan the setup QR with QRDrop, then press **Start**.

Receiver flow: open the **Receive** tab, press **Start Camera**, scan a setup QR, then scan the stream until a download link appears. Camera access requires HTTPS except on `localhost`.

## Build static assets

```bash
npm run build
```

The output in `dist/` can be hosted as a static site.

## Notes

- Files are read with the browser File API.
- SHA-256 is computed with Web Crypto.
- Gzip compression uses the browser `CompressionStream` API when available.
- Gzip decompression uses the browser `DecompressionStream` API when available.
- QR codes are rendered in the browser with the `qrcode` package from an ESM CDN.
- Receiver QR scanning uses `BarcodeDetector` when available, with a JavaScript `jsQR` fallback for iOS Safari and other browsers without `BarcodeDetector`.
- The protocol matches `PROTOCOL.md`.

## Suggested settings

Reliable default:

```text
chunkSize=300
fps=5
```

For large displays or simulator testing, try increasing chunk size and FPS gradually.
