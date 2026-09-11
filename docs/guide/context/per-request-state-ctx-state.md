# Per-Request State (ctx.state)

Use `ctx.state` to pass data, authenticated user sessions, database transaction clients, or metrics between middleware layers and your route handlers:

```typescript
// 1. Auth middleware attaches user to ctx.state
app.use(async (ctx, next) => {
  const token = ctx.headers["authorization"];
  if (token) {
    ctx.state.user = { id: 42, role: "admin" };
  }
  await next();
});

// 2. Route handler accesses ctx.state
app.get("/admin/profile", (ctx) => {
  const user = ctx.state.user;
  if (!user) {
    return ctx.status(401).send("Unauthorized");
  }
  return ctx.json({ user });
});
```

::: tip Automatic Cleanup
Because Volten recycles contexts using context pooling, `ctx.state` is automatically reset to `{}` at the end of each request, preventing any cross-request data leaks.
:::
