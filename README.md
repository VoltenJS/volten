<p align="center">
  <img src="https://github.com/VoltenJS/volten/blob/main/.github/voltenLogo.png?raw=true" alt="Volten Logo" width="500" style="margin-bottom: -80px;" />
</p>

<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency HTTP framework for Node.js and the Edge.</strong>
</p>

<p align="center">
  Volten is a small, fast HTTP framework with two first-class runtimes. Run on Node.js with <code>app.listen()</code>. Deploy to Cloudflare Workers, Bun, or any Web-fetch-compatible runtime with <code>app.createFetch()</code>. The same routes, the same middleware, the same <code>ctx</code> API — zero adapter overhead, zero extra dependencies.
</p>

---

## Write Once. Run Anywhere.

This is not a compatibility shim or a "it might work" footnote. Volten ships a **first-class dual-runtime architecture** — every route you write runs identically on Node.js and on any Web Fetch-compatible edge runtime, out of the box.

```javascript
import { App } from "volten";

const app = new App();

app.use((ctx, next) => {
  console.log(`${ctx.method} ${ctx.url}`);
  next();
});

app.get("/users/:id", (ctx) => {
  ctx.json({ userId: ctx.params.id, status: "active" });
});

app.post("/data", async (ctx) => {
  const body = await ctx.body();
  ctx.json({ received: body });
});

// ─── Node.js ──────────────────────────────────────────────
app.listen(3000);

// ─── Cloudflare Workers / Bun / Deno / any WinterCG runtime
export default { fetch: app.createFetch() };
```

**That's the whole file.** No separate entry points. No runtime checks. No adapter packages to install. The same `app` instance handles both — you pick how to expose it.

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

### Zero-overhead context pooling on both runtimes

On Node.js, Volten pre-allocates a pool of `NodeRequestContext` objects (default: 2 048) and recycles them across requests to eliminate GC pressure. On Edge runtimes, a parallel pool of `EdgeRequestContext` objects does the same thing, with the same recycling strategy. Neither pool involves the other runtime — there is no cross-runtime tax.

---

## Features

- **Zero runtime dependencies** — only the Node.js core API (or the Web platform API on edge).
- **Dual runtime** — `app.listen()` for Node, `app.createFetch()` for Cloudflare Workers / Bun / Deno / WinterCG.
- **Adaptive Traffic Triage** — Event-loop immune routing that automatically drops low-priority requests at the socket level when Node is under stress.
- **Trie-based router** — dynamic params (`/users/:id`) and wildcards.
- **Middleware chain** — global and per-route, with cascading composition. Works identically on both runtimes.
- **Native body parsing** — JSON, form-urlencoded, text, raw, and streaming multipart.
- **Streaming responses** — first-class backpressure-aware write/stream API on `ctx`.
- **Cookies and sessions** — built-in `ctx.cookies` helpers.
- **Static file serving** — path-traversal-safe file delivery (Node only).
- **Error handling** — global and custom error handlers with safe fallbacks on both runtimes.
- **Context pooling** — reusable `RequestContext` objects on both runtimes to reduce allocation overhead.

```text
volten/
└─ 🔒 No nested node_modules
└─ 🔒 No sudden security deprecations
└─ 🔒 100% auditable source code
```

---

## Quick Start

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

No changes to your routes or middleware. Swap `app.listen()` for `app.createFetch()` and you're done.

---

## Examples

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

## Architecture Notes

- **Routing:** Implemented as a trie (`RouteTree`). Match cost is proportional to path depth, not to the number of registered routes.
- **Dual context:** `NodeRequestContext` wraps Node's `IncomingMessage` / `ServerResponse`. `EdgeRequestContext` wraps the Web `Request` / `Response` API. Both extend the same base `RequestContext`, so every handler runs against an identical interface.
- **Context pooling:** Both context types are pooled (default: 2 048 each) and reset between requests to minimize GC pressure.
- **Streaming:** On Node, responses use `ServerResponse` directly with backpressure-aware `ctx.write` / `ctx.stream` / `ctx.end`. On Edge, responses are built as a Web `Response` object.

---

## Project Status

Volten is in **active alpha**. The core API is functional but may change before a 1.0 release. It is not yet recommended for production workloads.

The strict zero-dependency constraint means every utility — parsers, router, helpers — is implemented in-tree. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the rules and rationale.

---

## Contributing

Contributions are welcome. Before opening a PR:

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the zero-dependency rule is non-negotiable for production code.
2. Open an issue for non-trivial features so the design can be discussed first.
3. Run `pnpm run build` and verify your changes against the `examples/` directory.
4. Run `pnpm run lint` and `pnpm run format` before submitting.

---

## License

MIT © VoltenJS
