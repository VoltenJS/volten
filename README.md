<p align="center">
  <img src="https://github.com/VoltenJS/volten/blob/main/.github/voltenLogo.png?raw=true" alt="Volten Logo" width="500" style="margin-bottom: -80px;" />
</p>

<h1 align="center">Volten</h1>

<p align="center">
  <strong>A zero-dependency HTTP framework for Node.js.</strong>
</p>

<p align="center">
  Volten is a small, fast HTTP framework built directly on Node's native <code>http</code> module. It ships with routing, middleware, body parsing, streaming, static file serving, cookies, and error handling — all without a single runtime dependency.
</p>

---

## Features

- **Zero runtime dependencies** — only the Node.js core API.
- **Trie-based router** — dynamic params (`/users/:id`) and wildcards.
- **Middleware chain** — global, and per-route, with cascading composition.
- **Native body parsing** — JSON, form-urlencoded, text, raw, and streaming multipart.
- **Streaming responses** — first-class backpressure-aware write/stream API on `ctx`.
- **Cookies and sessions** — built-in `ctx.cookies` helpers.
- **Static file serving** — path-traversal-safe file delivery.
- **Error handling** — global and custom error handlers with safe fallbacks.
- **Context pooling** — reusable `RequestContext` objects to reduce allocation overhead.

```text
volten/
└─ 🔒 No nested node_modules
└─ 🔒 No sudden security deprecations
└─ 🔒 100% auditable source code
```

---

## Quick Start

### 1. Install from npm registry

Volten is oublic on npm. Install it with any package manager:

```bash
pnpm add volten
pnpm run build
```

### 2. Create a server

```javascript
import { App } from "volten";
const app = new App();

// Global middleware — runs on every request
app.use((ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.url}`);
  next();
});

app.get("/", (ctx) => {
  ctx.json({ message: "Welcome to Volten" });
});

// Dynamic route parameters
app.get("/users/:id", (ctx) => {
  ctx.json({ userId: ctx.params.id, status: "active" });
});

// Body parsing — JSON, form, text, raw, or streaming multipart
app.post("/data", async (ctx) => {
  const body = await ctx.body();
  ctx.json({ received: body });
});

app.listen(3000, () => {
  console.log("Volten listening on http://localhost:3000");
});
```

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
- **Context:** `RequestContext` objects are pooled (default pool size: 2048) and reset between requests to minimize GC pressure.
- **Streaming:** Responses use Node's native `ServerResponse` directly. `ctx.write`, `ctx.end`, and `ctx.stream` handle backpressure correctly.

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
