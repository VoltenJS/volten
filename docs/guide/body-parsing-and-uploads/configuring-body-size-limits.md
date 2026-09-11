# Configuring Body Size Limits

To protect your application from Denial of Service (DoS) attacks caused by oversized payloads, Volten enforces strict payload limits.

### Global Limit

Configure the default limit (in bytes) when instantiating `App`:

```typescript
const app = new App({
  // Limit bodies to 5MB globally (default is 1MB / 1048576 bytes)
  bodyLimit: 5 * 1024 * 1024,
});
```

### Per-Route Limit Override

You can override the global limit for individual routes using route options:

```typescript
// Allow up to 50MB for this specific endpoint
app.post('/large-upload', { bodyLimit: 50 * 1024 * 1024 }, async (ctx) => {
  const data = await ctx.body();
  return ctx.json({ received: true });
});

// Restrict this route to 10KB
app.post('/small-payload', { bodyLimit: 10 * 1024 }, async (ctx) => {
  const data = await ctx.body();
  return ctx.json({ received: true });
});
```

### Payload Limit Violations

When an incoming payload exceeds the configured limit (either indicated by the `Content-Length` header or detected while reading chunks from the stream):

1. Volten immediately pauses the incoming request stream.
2. It throws a `PayloadTooLargeError` (`ERR_PAYLOAD_TOO_LARGE`).
3. It responds to the client with an HTTP **413 Payload Too Large** status code.