# Router-Level Scoped Middleware

When using sub-routers ([`Router`](/guide/routing#sub-routers-router)), calling `router.use()` registers middleware that applies **only** to routes mounted on that specific router and its nested children:

```typescript
import { App, Router } from "volten";

const app = new App();
const apiRouter = new Router();

// Scoped to all /api/* routes
apiRouter.use(async (ctx, next) => {
  const apiKey = ctx.headers["x-api-key"];
  if (!apiKey || apiKey !== "secret-key-123") {
    return ctx.status(401).json({ error: "Invalid API Key" });
  }
  await next();
});

apiRouter.get("/users", (ctx) => {
  return ctx.json({ users: ["Alice", "Bob"] });
});

// Mount router
app.use("/api", apiRouter);

// Public route - untouched by the API key middleware
app.get("/health", (ctx) => {
  return ctx.send("OK");
});
```

### Middleware Inheritance Order

When a request is matched, middleware executes in strict hierarchical order:

1. Application-level global middleware (`app.use`)
2. Parent sub-router middleware
3. Child sub-router middleware
4. Route-specific inline middleware
5. Terminal route handler

---
