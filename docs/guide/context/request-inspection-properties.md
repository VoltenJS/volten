# Request Inspection Properties

### `ctx.method`

- **Type**: `string`
- The HTTP method verb in uppercase (`'GET'`, `'POST'`, `'PUT'`, `'DELETE'`, `'PATCH'`, etc.).

```typescript
app.use((ctx, next) => {
  console.log(`Incoming method: ${ctx.method}`);
  return next();
});
```

### `ctx.url`

- **Type**: `string`
- The complete request URL, including the query string (e.g. `'/search?term=volten&page=2'`).

### `ctx.path`

- **Type**: `string`
- The normalized path component of the request URL without the query string (e.g. `'/search'`).

### `ctx.params`

- **Type**: `Record<string, string>`
- An object containing dynamic route parameters captured by the router (e.g. `/users/:id` or wildcards `/*`).

```typescript
app.get("/users/:id", (ctx) => {
  const id = ctx.params.id;
  return ctx.json({ id });
});

app.get("/static/*", (ctx) => {
  const filePath = ctx.params["*"];
  return ctx.send(`Static path: ${filePath}`);
});
```

### `ctx.query`

- **Type**: `Record<string, string | string[]>`
- Lazy-parsed query parameters from the request URL. Volten decodes percent-encoded characters and plus signs, and groups duplicate keys into arrays:

```typescript
// GET /products?category=electronics&tag=deals&tag=sale
app.get("/products", (ctx) => {
  const category = ctx.query.category; // 'electronics'
  const tags = ctx.query.tag; // ['deals', 'sale']
  return ctx.json({ category, tags });
});
```

### `ctx.headers`

- **Type**: `Record<string, string | string[] | undefined>`
- A dictionary of all incoming HTTP request headers with lowercase keys.

```typescript
app.get("/headers", (ctx) => {
  const userAgent = ctx.headers["user-agent"];
  const authHeader = ctx.headers["authorization"];
  return ctx.json({ userAgent, authHeader });
});
```

### `ctx.ip`

- **Type**: `string`
- The client IP address. Volten inspects proxy headers in the following priority order:
  1. `X-Forwarded-For` (first IP in comma-separated list)
  2. `CF-Connecting-IP` (Cloudflare)
  3. Direct socket address (`req.socket.remoteAddress` in Node.js)

```typescript
app.get("/client-ip", (ctx) => {
  return ctx.json({ ip: ctx.ip });
});
```

### `ctx.host` and `ctx.hostname`

- **Type**: `string`
- `ctx.host`: Host header value (including port if present, e.g. `'localhost:3000'`).
- `ctx.hostname`: Host header value without port (e.g. `'localhost'`). Respects `X-Forwarded-Host`.

### `ctx.isMultipart`

- **Type**: `boolean`
- Returns `true` if the incoming request's `Content-Type` header includes `multipart/form-data`.

### `ctx.runtime`

- **Type**: `'node' | 'edge'`
- Identifies whether the application is running in a Node.js environment or an Edge/Web standard worker runtime.

### `ctx.env` and `ctx.executionCtx`

- **Type**: `unknown`
- In Edge environments (e.g. Cloudflare Workers), these provide access to environment bindings (KV namespaces, D1 databases, secrets) and execution context (`waitUntil`).

---
