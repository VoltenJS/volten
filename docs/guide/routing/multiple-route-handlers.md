# Multiple Route Handlers

You can pass multiple handler functions to any route. They are executed sequentially in an onion-style chain:

```typescript
const validateSession = async (ctx, next) => {
  const token = ctx.headers["x-session-token"];
  if (!token) {
    return ctx.status(401).send("Missing session token");
  }
  ctx.state.token = token;
  await next();
};

const checkPermissions = async (ctx, next) => {
  if (ctx.state.token !== "valid-secret") {
    return ctx.status(403).send("Forbidden");
  }
  await next();
};

// Chain multiple middleware guards before the terminal handler
app.get("/account/billing", validateSession, checkPermissions, (ctx) => {
  return ctx.json({ accountBalance: 1500 });
});
```

For more details on chaining handlers and sharing data, see the [Middleware Guide](/guide/middleware).
