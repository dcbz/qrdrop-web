# qrdrop-web

Browser-based QRDrop/QRA1 sender.

It is the web equivalent of `qrdrop-cli`: choose a local file, scan one setup QR, then stream animated data QR frames. All file processing happens client-side in the browser; the selected file is never uploaded and is not embedded in the URL.

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

Open the printed local URL, choose a file, press **Prepare**, scan the setup QR with QRDrop, then press **Start**.

## Build static assets

```bash
npm run build
```

The output in `dist/` can be hosted as a static site.

## Notes

- Files are read with the browser File API.
- SHA-256 is computed with Web Crypto.
- Gzip compression uses the browser `CompressionStream` API when available.
- QR codes are rendered in the browser with the `qrcode` package.
- The protocol matches `PROTOCOL.md`.

## Suggested settings

Reliable default:

```text
chunkSize=300
fps=5
```

For large displays or simulator testing, try increasing chunk size and FPS gradually.
