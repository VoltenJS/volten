<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency HTTP framework for Node.js and the Edge.</strong>
</p>

---

## Write Once. Run Anywhere.

This is not a compatibility shim. Volten ships a **first-class dual-runtime architecture** — the exact same routes and middleware run on both Node.js and any Web Fetch-compatible edge runtime with zero adapter overhead and zero extra dependencies.

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

**That's the whole file.** No separate entry points. No runtime checks. No adapter packages to install. The same `app` instance — you pick how to expose it.

---

## How It Works — Under the Hood

Volten abstracts away the Node ↔ Edge gap at the context layer. Every request is wrapped in a `RequestContext` that exposes the same `ctx` API regardless of runtime:

| What your handler uses                | Node.js                  | Edge                         |
| :------------------------------------ | :----------------------- | :--------------------------- |
| `ctx.method` / `ctx.url` / `ctx.path` | `IncomingMessage`        | Web `Request`                |
| `await ctx.body()`                    | Node socket stream       | `Request.json()` / `.text()` |
| `ctx.json(data)`                      | `ServerResponse.end()`   | Web `Response`               |
| `ctx.setHeader(k, v)`                 | `res.setHeader()`        | `Headers.set()`              |
| `ctx.cookies`                         | Parsed from Node headers | Parsed from Web headers      |

There is **no runtime dispatch in your handler code**. The adapter layer is invisible.

**Zero-overhead pooling on both runtimes.** On Node, Volten pre-allocates a pool of `NodeRequestContext` objects (default: 2048) and recycles them per request to eliminate GC pressure. On Edge, a parallel pool of `EdgeRequestContext` objects does the same — with no cross-runtime tax.

---

## Why Volten?

- **Zero runtime dependencies** — only the Node.js core API or the Web platform API on edge. No supply-chain risk, no nested `node_modules`.
- **Dual runtime** — `app.listen()` for Node, `app.createFetch()` for Cloudflare Workers / Bun / Deno / WinterCG runtimes.
- **Ultra-fast trie router** — match cost scales with path depth, not total route count.
- **Native body parsing** — JSON, form-urlencoded, text, raw, and streaming multipart, built in.
- **Context pooling** — pre-allocated, recycled contexts on both runtimes minimize GC overhead.
- **First-class streaming** — backpressure-aware `ctx.write` / `ctx.stream` / `ctx.end` on Node.
- **Cookies & error handling** — full built-in support on both runtimes.

---

## Quick Start

```bash
npm install volten
```

### Node.js

```javascript
import { App } from "volten";
const app = new App();

app.get("/", (ctx) => ctx.json({ hello: "world" }));

app.listen(3000, () => console.log("http://localhost:3000"));
```

### Cloudflare Workers / Edge

```javascript
import { App } from "volten";
const app = new App();

app.get("/", (ctx) => ctx.json({ hello: "world" })); // identical handler

export default { fetch: app.createFetch() };
```

---

## Features at a Glance

| Feature             | Node.js | Edge |
| :------------------ | :-----: | :--: |
| Trie-based routing  |   ✅    |  ✅  |
| Middleware chain    |   ✅    |  ✅  |
| Body parsing        |   ✅    |  ✅  |
| Cookie helpers      |   ✅    |  ✅  |
| Error handling      |   ✅    |  ✅  |
| Context pooling     |   ✅    |  ✅  |
| Static file serving |   ✅    |  —   |
| Streaming responses |   ✅    |  —   |

---

## Status

> **Notice:** Volten is currently in **active alpha**. The API is functional and tested, but breaking changes may occur before `v1.0.0`. It is not yet recommended for critical production workloads.

---

## License

[MIT](https://github.com/VoltenJS/volten/blob/main/LICENSE) © VoltenJS
