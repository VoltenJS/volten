<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency, ultra-fast HTTP framework for Node.js.</strong>
</p>

---

## Why Volten?

- **Zero Runtime Dependencies:** No supply-chain bloat, no nested `node_modules`, and zero risk of sudden security deprecations in third-party packages.
- **Ultra-Fast Trie Router:** Match cost scales with path depth (`/users/:id`), not total route count. Supports dynamic parameters and wildcards.
- **Built-in Performance:** `RequestContext` objects are pooled (default pool size: 2048) and reused across requests to minimize Garbage Collection (GC) overhead.
- **Native Utility Suite:** Full-featured body parsing (JSON, form-urlencoded, text, raw, streaming multipart), cookie management, and static file serving without external modules.
- **First-Class Streaming:** Direct access to Node's `ServerResponse` with backpressure-aware `ctx.write`, `ctx.stream`, and `ctx.end` APIs.

---

## Quick Start

### Installation

```bash
npm install volten
```

### Basic Example

```javascript
import { App } from "volten";
const app = new App();

// Global middleware
app.use((ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.url}`);
  next();
});

// JSON route
app.get("/", (ctx) => {
  ctx.json({ message: "Welcome to Volten" });
});

// Dynamic URL parameters
app.get("/users/:id", (ctx) => {
  ctx.json({ userId: ctx.params.id, status: "active" });
});

// Native body parsing
app.post("/data", async (ctx) => {
  const body = await ctx.body();
  ctx.json({ received: body });
});

app.listen(3000, () => {
  console.log("Volten running at http://localhost:3000");
});
```

---

## Key Features at a Glance

| Feature            | Description                                                              |
| :----------------- | :----------------------------------------------------------------------- |
| **Routing**        | Trie-based path matching, path traversal protection and wildcard support |
| **Middleware**     | Cascading composition across global and per-route scopes                 |
| **Body Parsing**   | Async `ctx.body()` for JSON, forms, raw buffers, and multipart uploads   |
| **Cookies**        | Native `ctx.cookies` parsing and serialization helpers                   |
| **Static Files**   | Safe, static asset serving (`volten.static()`)                           |
| **Error Handling** | Cascading error fallbacks with custom global handlers                    |

---

## Status

> **Notice:** Volten is currently in **active alpha**. The API is functional and tested, but breaking changes may occur before `v1.0.0`. It is not yet recommended for critical production workloads.

---

## License

[MIT](https://github.com/VoltenJS/volten/blob/main/LICENSE) © VoltenJS
