# Route-Specific Middleware

You can attach one or more middleware functions directly to individual route definitions:

```typescript
import { App } from "volten";

const app = new App();

// Route guard middleware
const requireAuth = async (ctx, next) => {
  const auth = ctx.headers["authorization"];
  if (!auth) {
    // Short-circuit: do not call next()
    return ctx.status(401).json({ error: "Authentication required" });
  }
  ctx.state.token = auth;
  await next();
};

const requireAdmin = async (ctx, next) => {
  if (ctx.state.token !== "Bearer admin-token") {
    return ctx.status(403).json({ error: "Admin access required" });
  }
  await next();
};

// Chain guards directly on the route definition
app.get("/admin/dashboard", requireAuth, requireAdmin, (ctx) => {
  return ctx.json({ message: "Welcome Admin" });
});
```

Route-specific middleware also works alongside route options:

```typescript
app.post(
  "/admin/upload",
  { bodyLimit: 50 * 1024 * 1024, priority: "critical" },
  requireAuth,
  requireAdmin,
  async (ctx) => {
    return ctx.send("Uploaded");
  },
);
```

---
