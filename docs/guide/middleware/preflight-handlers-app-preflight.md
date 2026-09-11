# Preflight Handlers (app.preflight)

In addition to standard middleware, Volten provides `app.preflight()`.

### How Preflight Differs from Middleware

- Standard middleware (`app.use`) runs **after** route matching has located the matching endpoint.
- Preflight handlers (`app.preflight`) run **before route matching begins** for every single incoming request.

```mermaid
flowchart LR
    Request[Incoming Request] --> Preflight[app.preflight Handlers]
    Preflight --> RouteLookup[Route Tree Lookup]
    RouteLookup --> Middleware[app.use / Middleware]
    Middleware --> Handler[Route Handler]
```

### Typical Preflight Use Cases

- Global CORS preflight response generation (`OPTIONS` method short-circuiting)
- Early request filtering / IP blocklists before consuming route tree resources
- Global tracing headers / Correlation IDs

```typescript
app.preflight(async (ctx) => {
  // Inject early correlation ID
  ctx.setHeader("X-Request-Id", crypto.randomUUID());

  // Handle CORS preflight before routing
  if (ctx.method === "OPTIONS") {
    ctx.setHeader("Access-Control-Allow-Origin", "*");
    ctx.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    ctx.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return ctx.status(204).send("");
  }
});
```

---
