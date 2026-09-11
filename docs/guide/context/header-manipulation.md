# Header Manipulation

### `ctx.setHeader(key, value)`
Sets an outgoing response header. Supports strings, numbers, or arrays of strings (for headers like `Set-Cookie`):

```typescript
app.get('/custom-headers', (ctx) => {
  ctx.setHeader('X-Powered-By', 'Volten');
  ctx.setHeader('X-Request-Id', 'req_abc123');
  return ctx.send('OK');
});
```

### `ctx.getHeader(key)`
Retrieves the value of a previously set outgoing response header:

```typescript
const contentType = ctx.getHeader('Content-Type');
```

### `ctx.getHeaders()`
Returns an object of all outgoing headers currently registered on the response.

### `ctx.removeHeader(key)`
Removes an outgoing header before it is transmitted to the client:

```typescript
ctx.setHeader('X-Internal-Debug', 'true');
// Later in the pipeline:
ctx.removeHeader('X-Internal-Debug');
```

### `ctx.type`
Convenient getter and setter for the `Content-Type` header:

```typescript
ctx.type = 'application/xml';
console.log(ctx.type); // 'application/xml'
```

### `ctx.headersSent` and `ctx.sent`
- **`ctx.headersSent`**: Boolean indicating whether HTTP response headers have been sent over the wire.
- **`ctx.sent`**: Boolean indicating whether the response stream has closed/ended.

---