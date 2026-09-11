# State Sharing with ctx.state

`ctx.state` is a dedicated object on the request context intended for passing data between middlewares and route handlers.

### Why Use `ctx.state`?

- **Scoped to the Request**: Unlike global variables, `ctx.state` exists solely for the duration of the current HTTP request.
- **Context Pooling Cleanliness**: Because Volten pools and recycles `RequestContext` objects, `ctx.state` is automatically reset to `{}` upon request completion, ensuring **zero cross-request state pollution or memory leaks**.
- **Safe Separation**: Keeps custom application state separated from framework internals.

### Example: Authenticated User Injection

```typescript
import { App } from "volten";

interface User {
  id: string;
  role: string;
}

const app = new App();

// 1. Middleware parses token and attaches user to state
app.use(async (ctx, next) => {
  const authHeader = ctx.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // Decode token or fetch user from cache/database
    ctx.state.user = { id: "usr_42", role: "editor" } as User;
  }
  await next();
});

// 2. Downstream middleware inspects state
const requireEditor = (ctx, next) => {
  const user = ctx.state.user as User | undefined;
  if (!user || user.role !== "editor") {
    return ctx.status(403).send("Forbidden: Editors only");
  }
  return next();
};

// 3. Route handler uses state data
app.get("/articles/drafts", requireEditor, (ctx) => {
  const user = ctx.state.user as User;
  return ctx.json({
    editorId: user.id,
    drafts: ["Draft 1", "Draft 2"],
  });
});
```

---
