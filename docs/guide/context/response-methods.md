# Response Methods

### `ctx.send(data, statusCode?)`

The most versatile response method. Automatically determines the response type based on the input argument:

- **String**: Sends with `Content-Type: text/plain; charset=utf-8`.
- **Buffer / Uint8Array**: Sends with `Content-Type: application/octet-stream; charset=utf-8`.
- **Object / Array / Boolean / Number**: Serializes and sends with `Content-Type: application/json; charset=utf-8`.

```typescript
app.get("/example-string", (ctx) => {
  return ctx.send("Hello World");
});

app.get("/example-json", (ctx) => {
  return ctx.send({ status: "ok" }, 200);
});
```

### `ctx.json(data, statusCode?)`

Sends a JSON response with `Content-Type: application/json; charset=utf-8`.

```typescript
app.get("/api/user", (ctx) => {
  return ctx.json({ id: 1, name: "Alice" });
});

// With custom status code
app.post("/api/user", async (ctx) => {
  const data = await ctx.body();
  return ctx.json({ created: true, data }, 201);
});
```

::: tip High-Performance JIT Serialization
Volten includes an internal JIT compilation cache (`app.JITCache`). Recurring payload shapes are analyzed and serialized through specialized compiled stringifiers, significantly outperforming standard `JSON.stringify`.
:::

### `ctx.text(data, statusCode?)`

Sends a raw UTF-8 plain text response:

```typescript
app.get("/robots.txt", (ctx) => {
  return ctx.text("User-agent: *\nDisallow: /admin");
});
```

### `ctx.buffer(data, statusCode?)`

Sends binary data (`Buffer` in Node.js, `Uint8Array` in Edge):

```typescript
app.get("/binary", (ctx) => {
  const buf = Buffer.from("binary-data-stream");
  return ctx.buffer(buf);
});
```

### Sending HTML

To send HTML, set the `Content-Type` header via `ctx.type` or `ctx.setHeader()` and deliver the string payload with `ctx.send()`:

```typescript
// Method 1: Using ctx.type
app.get("/", (ctx) => {
  ctx.type = "text/html; charset=utf-8";
  return ctx.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head><title>Volten App</title></head>
      <body>
        <h1>Hello from Volten!</h1>
      </body>
    </html>
  `);
});

// Method 2: Fluent chaining with ctx.setHeader
app.get("/welcome", (ctx) => {
  return ctx
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send("<h2>Welcome to the dashboard</h2>");
});
```

### `ctx.status(code)` and `ctx.statusCode`

Sets the HTTP response status code. Returns `this` for fluent method chaining:

```typescript
// Fluent chaining
app.post("/items", (ctx) => {
  return ctx.status(201).json({ success: true });
});

// Property assignment
app.get("/not-found", (ctx) => {
  ctx.statusCode = 404;
  return ctx.text("Custom Not Found Message");
});
```

---
