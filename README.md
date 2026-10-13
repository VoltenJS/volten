<p align="center">
  <img src="https://github.com/VoltenJS/volten/blob/main/.github/voltenLogo.svg?raw=true" alt="Volten Logo" width="500" style="margin-bottom: -80px;" />
</p>

<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency HTTP framework for Node.js and the Edge.</strong>
</p>

<p align="center">
  Volten is a small, fast HTTP framework with two first-class runtimes. Run on Node.js with <code>app.listen()</code>. Deploy to Cloudflare Workers, Bun, or any Web-fetch-compatible runtime with <code>app.createFetch()</code>. The same route and middleware APIs across both runtimes, without requiring a separate adapter package.
</p>

---

## ⚡ The All-in-One Snippet

See Volten's core features in action in a single file:

```javascript
import { App } from "volten";

// Enable Adaptive Traffic Triage (ATT) to drop low-priority requests under load
const app = new App({ adaptiveTriage: { enabled: true } });
// 1. Middleware chain
app.use((ctx, next) => {
  ctx.setHeader("X-Powered-By", "Volten");
  next();
});

// 2. Static file serving (Node only)
app.static("./public");

// 3. Trie-based routing, params, and cookies
app.get("/user/:id", { priority: "low" }, (ctx) => {
  // Dropped when state is "WARNING" or "CRITICAL"
  const session = ctx.cookies["session_id"];
  ctx.json({ userId: ctx.params.id, session });
});

// 4. Native body parsing
app.post("/data", { priority: "critical" }, async (ctx) => {
  // Never dropped
  const body = await ctx.body();
  ctx.status(201).json({ received: body });
});

// 5. Streaming responses (Node only)
app.get("/stream", async (ctx) => {
  // Routes have a default "normal" priority
  // Dropped when state is "CRITICAL"
  await ctx.sendFile("large-file.txt");
  console.log("File Sent!");
});

// 6. Global error handling
app.onError((err, ctx) => {
  console.error(err);
  ctx.status(500).json({ error: "Internal Server Error" });
});

// ─── Dual Runtime Support ─────────────────────────────────

// Node.js
app.listen(3000, () => console.log("Listening on :3000"));

// Cloudflare Workers / Bun / Deno / WinterCG
export default { fetch: app.createFetch() };
```

---

## 🛡️ Adaptive Traffic Triage (ATT)

Volten includes an optional **Adaptive Traffic Triage (ATT)** feature that monitors event-loop delay and sheds requests according to their configured priority when the triage state is `WARNING` or `CRITICAL`. Shed requests receive `503 Service Unavailable`. ATT is a load-shedding mechanism, not a rate limiter or a guarantee that an application will remain available under every failure mode.

---

## 🏎️ Performance-Oriented Internals

Volten uses implementation techniques intended to reduce work on common request paths. Actual throughput and latency depend on workload, runtime, configuration, and hardware; use the repository's benchmarks to evaluate a specific deployment.

- **Compiled route matching on Node.js**: Volten builds a matcher from the registered radix tree. For case-sensitive matching without a query string, eligible static routes can use a generated method/path-length switch fast path; other routes use the compiled radix-tree matcher.
- **Route execution plans**: Routes with one effective handler use a direct executor; routes with multiple handlers retain the normal composed middleware chain.
- **Lazy URL properties**: Path and query parsing are deferred until those properties are accessed. This avoids unnecessary parsing work, but does not mean that all URL handling is allocation-free.
- **Edge URL extraction**: Common absolute HTTP(S) request URLs use a lightweight path-and-search extractor. URLs requiring standard URL normalization fall back to `new URL()`.

---

## 🌟 First-Class Features

- **Dual Runtime Architecture** — Write once, run on Node.js (`app.listen()`) or any Web Fetch-compatible edge runtime (`app.createFetch()`).
- **Adaptive Traffic Triage (ATT)** — Optional event-loop-delay-based load shedding with route priorities.
- **Zero Runtime Dependencies** — The published package has no runtime package dependencies; it uses native Node.js and Web platform APIs.
- **Context Pooling** — Pre-allocates reusable request contexts to reduce repeated setup and allocation work; other request-path allocations can still occur.
- **Radix-Tree Router** — Supports static paths, dynamic parameters (`/users/:id`), and wildcards, with a generated matcher on Node.js and tree traversal in Edge mode.
- **Middleware Chain** — Global and per-route middleware with cascading composition. Works identically on both runtimes.

---

## ✨ Additional Features

- **Native Body Parsing** — Built-in parsers for JSON, form-urlencoded, text, raw, and streaming multipart data.
- **First-Class Streaming** — Backpressure-aware `ctx.write` / `ctx.stream` / `ctx.end` API on Node.js.
- **Cookies & Sessions** — Read and set cookies effortlessly using built-in `ctx.cookies` helpers.
- **Static File Serving** — Path-traversal-safe static file delivery for Node.js environments.
- **Error Handling** — Centralized global and custom error handlers with safe fallbacks across platforms.

---

## How the Dual Runtime Works

Volten resolves the Node ↔ Edge gap internally, at the context level. Every incoming request is wrapped in a `RequestContext` that presents the same unified API regardless of the underlying platform:

| What your handler uses                | Node.js under the hood   | Edge under the hood                 |
| ------------------------------------- | ------------------------ | ----------------------------------- |
| `ctx.method` / `ctx.url` / `ctx.path` | `IncomingMessage`        | Web `Request`                       |
| `ctx.headers`                         | Node header object       | `Headers` → plain object            |
| `await ctx.body()`                    | Streams the Node socket  | Awaits `Request.json()` / `.text()` |
| `ctx.json(data)`                      | `ServerResponse.end()`   | Builds a Web `Response`             |
| `ctx.send(text)`                      | `ServerResponse.end()`   | Builds a Web `Response`             |
| `ctx.status(code)`                    | `res.statusCode`         | Edge response status                |
| `ctx.setHeader(k, v)`                 | `res.setHeader()`        | `Headers.set()`                     |
| `ctx.cookies`                         | Parsed from Node headers | Parsed from Web headers             |

There is **no runtime dispatch in your handler code**. The adapter layer is invisible — your logic stays clean and portable.

---

## 🚀 Quick Start

### 1. Install from npm registry

Volten is public on npm. Install it with any package manager:

```bash
pnpm add volten
```

### 2. Node.js server

```javascript
import { App } from "volten";
const app = new App();

app.get("/", (ctx) => {
  ctx.json({ message: "Welcome to Volten" });
});

app.listen(3000, () => {
  console.log("Volten listening on http://localhost:3000");
});
```

### 3. Edge / Cloudflare Workers

```javascript
import { App } from "volten";
const app = new App();

app.get("/", (ctx) => {
  ctx.json({ message: "Welcome to Volten" }); // exact same handler
});

export default { fetch: app.createFetch() };
```

---

## 📂 Examples

The [`examples/`](./examples) directory contains runnable, self-contained samples:

| #   | File                          | Demonstrates                          |
| --- | ----------------------------- | ------------------------------------- |
| 01  | `01-hello-world.js`           | Minimal server and route registration |
| 02  | `02-middleware.js`            | Global and per-route middleware       |
| 03  | `03-json-response.js`         | JSON responses with `ctx.json`        |
| 04  | `04-routing-and-wildcards.js` | Dynamic params and wildcards          |
| 05  | `05-global-error-handling.js` | Centralized error handling            |
| 06  | `06-static-file-serving.js`   | Static files via `volten.static()`    |
| 07  | `07-body-parsing.js`          | JSON, form, and text body parsing     |
| 08  | `08-cookies-and-sessions.js`  | Cookie parsing and serialization      |
| 09  | `09-stream-responses.js`      | Streaming responses with backpressure |
| 10  | `10-cors-and-security.js`     | CORS, security headers, and hardening |

---

## Project Status

Volten is in **active alpha**. The core API is functional but may change before a 1.0 release. It is not yet recommended for production workloads.

The strict zero-dependency constraint means every utility — parsers, router, helpers — is implemented in-tree. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the rules and rationale.

---

## License

MIT © VoltenJS
