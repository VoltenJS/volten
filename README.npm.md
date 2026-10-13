<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency HTTP framework for Node.js and the Edge.</strong>
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

Volten includes an optional **Adaptive Traffic Triage (ATT)** feature that monitors event-loop delay and sheds requests according to their configured priority when the triage state is `WARNING` or `CRITICAL`. Shed requests receive `503 Service Unavailable`. ATT is load shedding, not rate limiting, and does not guarantee availability under every failure mode.

---

## 🌟 First-Class Features

- **Dual Runtime Architecture** — Write once, run on Node.js (`app.listen()`) or any Web Fetch-compatible edge runtime (`app.createFetch()`).
- **Adaptive Traffic Triage (ATT)** — Optional event-loop-delay-based load shedding with route priorities.
- **Zero Runtime Dependencies** — The published package has no runtime package dependencies; it uses native Node.js and Web platform APIs.
- **Context Pooling** — Pre-allocates reusable request contexts to reduce repeated setup and allocation work; other request-path allocations can still occur.
- **Radix-Tree Router** — Supports static paths, dynamic parameters (`/users/:id`), and wildcards, with different matcher paths depending on runtime and route shape.
- **Middleware Chain** — Global and per-route middleware with cascading composition. Works identically on both runtimes.

---

## ✨ Second-Class Features

- **Native Body Parsing** — Built-in parsers for JSON, form-urlencoded, text, raw, and streaming multipart data.
- **First-Class Streaming** — Backpressure-aware `ctx.write` / `ctx.stream` / `ctx.end` API on Node.js.
- **Cookies & Sessions** — Read and set cookies effortlessly using built-in `ctx.cookies` helpers.
- **Static File Serving** — Path-traversal-safe static file delivery for Node.js environments.
- **Error Handling** — Centralized global and custom error handlers with safe fallbacks across platforms.

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

---

## 🚀 Quick Start

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

## Status

> **Notice:** Volten is currently in **active alpha**. The API is functional and tested, but breaking changes may occur before `v1.0.0`. It is not yet recommended for critical production workloads.

---

## License

[MIT](https://github.com/VoltenJS/volten/blob/main/LICENSE) © VoltenJS
