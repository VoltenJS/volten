# Static Files

Volten provides built-in, high-performance static file serving via `app.static()`.

There is no need to install external packages or configure complex middleware. Volten handles file serving directly with:

- **Zero-copy stream piping** with socket backpressure management.
- **Built-in Directory Traversal Protection** to prevent path breakout attacks.
- **Automatic ETag Generation** and conditional HTTP caching (`304 Not Modified`).
- **Comprehensive MIME Type Mapping** for modern web assets.
- **Programmatic File Serving & Downloads** via `ctx.sendFile()` and `ctx.download()`.

---

## Quick Start: `app.static`

To serve assets such as images, stylesheets, scripts, and fonts from a directory:

```typescript
import { App } from "volten";

const app = new App();

// Serve files from the 'public' directory
app.static("public");

app.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
```

Given the following project folder structure:

```text
my-app/
├── public/
│   ├── css/
│   │   └── style.css
│   ├── images/
│   │   └── logo.png
│   └── index.html
└── server.ts
```

Your files are immediately accessible over HTTP:

- `http://localhost:3000/index.html`
- `http://localhost:3000/css/style.css`
- `http://localhost:3000/images/logo.png`

::: tip Path Resolution
`app.static()` checks for both absolute paths and paths relative to the current working directory (`./folderPath`). If the directory does not exist on startup, an error is thrown immediately.
:::

---

## How Static Routing Works

In Volten, routing is handled in order of specificity:

1. **Explicit Routes First**: Dynamic and static routes defined with `app.get()`, `app.post()`, etc., are checked against the internal Route Tree.
2. **Static File Fallback**: If no registered route matches the incoming path and `app.static()` is configured, Volten attempts to locate and stream the corresponding file from the static folder.
3. **404 / 405 Handling**: If the file does not exist, or the path escapes the static directory, Volten invokes the error handling pipeline with a `NotFoundError`.

---

## Security & Path Traversal Protection

Serving static files requires rigorous validation to prevent malicious path traversal exploits (e.g. requests targeting `/../../etc/passwd` or `/..%2f..%2f.env`).

Volten includes a built-in security layer (`isFileInFolder`):

- Resolves the canonical physical paths of both the target folder and the requested file using `fs.realpath()`.
- Verifies that the resolved file path strictly resides within the configured root folder boundary.
- Automatically rejects any traversal attempt by returning a `404 Not Found` without disclosing filesystem structure.

```bash
# Traversal attempts are blocked securely:
curl http://localhost:3000/../../secret.txt
# => 404 Not Found
```

---

## HTTP Caching & 304 Not Modified

To minimize bandwidth usage and latency, Volten automatically generates and validates HTTP cache headers for all static files.

### ETag Calculation

Volten automatically computes a weak ETag based on the file size and the last modification timestamp (`mtime`):

```http
ETag: W/"1a4c-18f4a9b2c10"
Last-Modified: Wed, 09 Sep 2026 20:00:00 GMT
```

### Conditional Requests

When a browser or CDN makes a conditional request with:

- `If-None-Match: W/"..."` matching the current ETag, or
- `If-Modified-Since` timestamp matching or newer than the file's modification time

Volten immediately sends an empty **`304 Not Modified`** response, bypassing disk reads and saving bandwidth.

---

## Automatic MIME Type Detection

Volten includes a built-in dictionary supporting more than 50 common file extensions without relying on external MIME databases:

- **Web & Logic**: `.html`, `.htm`, `.js`, `.mjs`, `.css`, `.json`, `.jsonld`, `.xml`, `.txt`, `.wasm`
- **Images**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.ico`, `.bmp`, `.tiff`
- **Fonts**: `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- **Audio & Video**: `.mp4`, `.webm`, `.ogv`, `.mov`, `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac`
- **Documents & Archives**: `.pdf`, `.zip`, `.tar`, `.gz`, `.csv`, `.docx`, `.xlsx`

Any unrecognized extension defaults to `application/octet-stream`.

---

## Programmatic File Serving: `ctx.sendFile`

Beyond `app.static()`, you can serve files programmatically from any route handler using `ctx.sendFile()`:

```typescript
import path from "node:path";

app.get("/reports/:id", async (ctx) => {
  const reportId = ctx.params.id;
  const filePath = path.resolve(`./reports/${reportId}.pdf`);

  // Sends the file with automatic MIME detection, ETags, and streaming
  await ctx.sendFile(filePath);
});
```

### Options

```typescript
await ctx.sendFile(filePath, 200, {
  // Optional callback for stream or lookup errors
  errCallback: (err, ctx) => {
    console.error("File delivery error:", err);
  },
});
```

---

## Triggering Browser Downloads: `ctx.download`

If you want the browser to prompt a "Save As" file download dialog instead of displaying the file inline, use `ctx.download()`:

```typescript
app.get("/export/data", async (ctx) => {
  const exportPath = "./storage/exports/export-2026.csv";

  // Serves the file with Content-Disposition: attachment; filename="..."
  await ctx.download(exportPath, "annual-report.csv");
});
```

Volten properly formats the `Content-Disposition` header with RFC 5987 / UTF-8 encoding support (`filename*=UTF-8''...`), ensuring non-ASCII filenames display accurately across all modern browsers.
