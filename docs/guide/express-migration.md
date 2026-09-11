# Express to Volten Migration Guide

Migrating from **Express** to **Volten** is straightforward. Volten is designed to feel familiar to Express developers, while eliminating bloated dependency trees, offering native modern TypeScript support, and delivering significantly higher throughput with an Adaptive JIT Engine.

---

## Why Migrate to Volten?

| Feature              | Express                                        | Volten                                                          |
| :------------------- | :--------------------------------------------- | :-------------------------------------------------------------- |
| **Dependencies**     | 30+ npm packages                               | **0 dependencies** (built strictly on Node.js core)             |
| **Architecture**     | Separate `(req, res, next)`                    | Unified **`RequestContext` (`ctx`)**                            |
| **Body Parsing**     | Requires `body-parser` or `express.json()`     | **Built-in lazy parsing** (`await ctx.body()`)                  |
| **File Uploads**     | Requires `multer`, `busboy`, or `formidable`   | **Built-in streaming multipart** (`ctx.multipart()`)            |
| **Cookies**          | Requires `cookie-parser`                       | **Built-in** (`ctx.cookies`, `ctx.setCookie`)                   |
| **Static Files**     | `express.static()` via `serve-static`          | **Built-in** (`app.static()`) with ETags & traversal protection |
| **Middleware Model** | Linear callback chaining                       | **Modern async onion model** (`await next()`)                   |
| **Error Handling**   | 4-parameter middleware `(err, req, res, next)` | Centralized **`app.onError((err, ctx) => ...)`**                |
| **Edge Ready**       | Node.js only                                   | **Runs on Node.js and Edge/Fetch environments**                 |

---

## Quick Reference: Express vs Volten

Here is a side-by-side syntax comparison for common operations:

| Action                | Express                                  | Volten                                            |
| :-------------------- | :--------------------------------------- | :------------------------------------------------ |
| **Initialize App**    | `const app = express();`                 | `const app = new App();`                          |
| **Listen on Port**    | `app.listen(3000, () => ...);`           | `app.listen(3000, () => ...);`                    |
| **Route Parameters**  | `req.params.id`                          | `ctx.params.id` _(strongly-typed)_                |
| **Query String**      | `req.query.search`                       | `ctx.query.search`                                |
| **Read JSON Body**    | `req.body` _(requires middleware)_       | `await ctx.body()`                                |
| **Read Raw Text**     | `req.body` _(requires `express.text()`)_ | `await ctx.body('text')`                          |
| **Read Stream**       | `req` _(Node stream)_                    | `ctx.bodyStream` _(Web ReadableStream)_           |
| **Send JSON**         | `res.json({ ok: true })`                 | `ctx.json({ ok: true })` or `return { ok: true }` |
| **Send Text**         | `res.send('hello')`                      | `ctx.send('hello')` or `return 'hello'`           |
| **Set Status Code**   | `res.status(201)`                        | `ctx.status(201)`                                 |
| **Set Header**        | `res.set('X-Name', 'value')`             | `ctx.setHeader('X-Name', 'value')`                |
| **Get Header**        | `req.get('authorization')`               | `ctx.headers['authorization']`                    |
| **Read Cookies**      | `req.cookies.token` _(requires package)_ | `ctx.cookies.token`                               |
| **Set Cookie**        | `res.cookie('token', val, opts)`         | `ctx.setCookie('token', val, opts)`               |
| **Send Static Files** | `app.use(express.static('public'))`      | `app.static('public')`                            |
| **File Download**     | `res.download(filePath, 'file.pdf')`     | `await ctx.download(filePath, 'file.pdf')`        |

---

## Key Differences Explained

### 1. Unified Context (`ctx`) vs `req`/`res`

In Express, handlers take `(req, res, next)`. You constantly pass two separate objects around:

```javascript
// Express
app.get("/user/:id", (req, res) => {
  const id = req.params.id;
  res.status(200).json({ id });
});
```

In Volten, everything is unified under a single **`ctx` (RequestContext)** object:

```typescript
// Volten
app.get("/user/:id", (ctx) => {
  const id = ctx.params.id;
  return ctx.status(200).json({ id });
});
```

::: tip Handler Return Values
In Volten, you can also directly return strings, objects, or Web Standard `Response` instances. Volten automatically serializes and sends them!

```typescript
app.get("/hello", () => ({ message: "Hello World!" }));
```

:::

---

### 2. Request Body Parsing

#### In Express

You must register middleware globally before routes are declared:

```javascript
// Express
const express = require("express");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/items", (req, res) => {
  const item = req.body; // already parsed into memory
  res.json({ saved: item });
});
```

#### In Volten

Body parsing is **lazy and built-in**. No middleware setup required:

```typescript
// Volten
import { App } from "volten";
const app = new App();

app.post("/items", async (ctx) => {
  const item = await ctx.body(); // parsed on-demand
  return ctx.json({ saved: item });
});
```

---

### 3. File Uploads

#### In Express

Express requires configuring an external multipart library such as `multer`:

```javascript
// Express
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.single("avatar"), (req, res) => {
  console.log(req.file.path);
  res.send("Uploaded");
});
```

#### In Volten

Volten includes streaming multipart uploads out-of-the-box:

```typescript
// Volten
app.post("/upload", async (ctx) => {
  for await (const part of ctx.multipart()) {
    if (part.isFile && part.name === "avatar") {
      await part.save(`./uploads/${part.filename}`);
    }
  }
  return ctx.send("Uploaded");
});
```

---

### 4. Middleware: The Async Onion Model

Express uses a callback-based middleware chain where forgetting to call `next()` or calling it after ending the response can lead to subtle hanging requests or crashes:

```javascript
// Express
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`Duration: ${Date.now() - start}ms`);
  });
  next();
});
```

Volten uses an **async onion model** (similar to Koa). You `await next()` to execute downstream handlers, and post-processing occurs cleanly when execution unrolls:

```typescript
// Volten
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.method} ${ctx.path} - ${Date.now() - start}ms`);
});
```

::: tip Next Call Safety
Volten actively detects duplicate `next()` invocations or calling `next()` after a response has been sent, safely throwing `InvalidNextCallError` to prevent silent corruption.
:::

---

### 5. Error Handling

#### In Express

Express identifies error handlers by checking function arity `fn.length === 4`:

```javascript
// Express
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});
```

If you accidentally define `(err, req, res)` with 3 arguments, Express silently treats it as regular middleware, leaving errors unhandled.

#### In Volten

Error handling is explicit and registered with `app.onError()`:

```typescript
// Volten
app.onError((err, ctx) => {
  console.error(`[Error] ${ctx.method} ${ctx.path}:`, err.message);
  return ctx.status(err.statusCode || 500).json({
    success: false,
    error: err.message,
  });
});
```

## Interactive Migration Morph

Watch how cleanly your Express code transforms into Volten. Switch between **Express (Before)** and **Volten (After)**, or press **Auto-Morph** to animate the token transitions powered by `@shikijs/magic-move`:

<ClientOnly>
  <ExpressMagicMove />
</ClientOnly>

---

## Comprehensive Migration Example

Below is a complete side-by-side comparison showing how an Express service with authentication, body parsing, static files, and error handling translates to Volten.

### Before: Express Application

```javascript
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use("/static", express.static(path.join(__dirname, "public")));

// Auth middleware
const requireAuth = (req, res, next) => {
  const token = req.cookies.authToken;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = "user_123";
  next();
};

// Routes
app.get("/api/profile", requireAuth, (req, res) => {
  res.json({ userId: req.userId, name: "Alice" });
});

app.post("/api/items", requireAuth, (req, res) => {
  const data = req.body;
  res.status(201).json({ created: true, data });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(3000, () => {
  console.log("Express running on port 3000");
});
```

### After: Volten Application

```typescript
import { App } from "volten";

const app = new App();

// Serve static files
app.static("public");

// Auth middleware using ctx.state and ctx.cookies
const requireAuth = async (ctx, next) => {
  const token = ctx.cookies.authToken;
  if (!token) {
    return ctx.status(401).json({ error: "Unauthorized" });
  }
  ctx.state.userId = "user_123";
  await next();
};

// Routes
app.get("/api/profile", requireAuth, (ctx) => {
  return ctx.json({ userId: ctx.state.userId, name: "Alice" });
});

app.post("/api/items", requireAuth, async (ctx) => {
  const data = await ctx.body();
  return ctx.status(201).json({ created: true, data });
});

// Global Error Handler (automatically handles 404s and thrown errors)
app.onError((err, ctx) => {
  const status = err.statusCode || 500;
  return ctx.status(status).json({ error: err.message });
});

app.listen(3000, () => {
  console.log("Volten running on port 3000");
});
```

---

## Migration Checklist

1. [ ] **Remove unused packages**: Uninstall `body-parser`, `cookie-parser`, `serve-static`, and `multer`.
2. [ ] **Change handler signature**: Update `(req, res)` to `(ctx)`.
3. [ ] **Convert parameters**: Change `req.params.x` to `ctx.params.x`.
4. [ ] **Convert body access**: Replace `req.body` with `await ctx.body()`.
5. [ ] **Update middleware**: Replace `(req, res, next)` with `async (ctx, next) => { await next(); }`.
6. [ ] **Use `ctx.state`**: Migrate arbitrary `req` properties (like `req.user`) to `ctx.state.user`.
7. [ ] **Register error handler**: Replace 4-argument middleware with `app.onError((err, ctx) => ...)`.
