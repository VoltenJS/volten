# Route Registration

Route handlers are registered directly on your application instance or on a sub-router using standard HTTP method verbs:

- `app.get(path, ...handlers)`
- `app.post(path, ...handlers)`
- `app.put(path, ...handlers)`
- `app.patch(path, ...handlers)`
- `app.delete(path, ...handlers)`

### Basic Example

```typescript
import { App } from "volten";

const app = new App();

// GET endpoint
app.get("/users", (ctx) => {
  return ctx.json({ users: [] });
});

// POST endpoint
app.post("/users", async (ctx) => {
  const body = await ctx.body();
  return ctx.status(201).json({ created: true, data: body });
});

// PUT endpoint
app.put("/users/:id", async (ctx) => {
  const body = await ctx.body();
  return ctx.json({ updated: true, id: ctx.params.id, data: body });
});

// PATCH endpoint
app.patch("/users/:id", async (ctx) => {
  const body = await ctx.body();
  return ctx.json({ patched: true, id: ctx.params.id, data: body });
});

// DELETE endpoint
app.delete("/users/:id", (ctx) => {
  return ctx.status(200).json({ deleted: true, id: ctx.params.id });
});

app.listen(3000, () => {
  app.logger.info("Server running on http://localhost:3000");
});
```

### Route Introspection (`app.printRoutes()`)

Once you have registered all of your application's routes and mounted any sub-routers, you can use `app.printRoutes()` to instantly output a slick ASCII table mapping out every registered path.

This feature gives you complete visibility into exactly which methods exist, their full namespace paths, and how many inline middlewares they invoke!

```typescript
app.get("/users", (ctx) => ctx.json([]));
app.post("/users", auth, (ctx) => ctx.json({}));
app.group("/api", (api) => {
  api.delete("/users/:id", auth, (ctx) => ctx.text("Deleted"));
});

// Print the ASCII Table to the console
app.printRoutes();
```

**Output:**

```text
┌─────────┬──────────────────────────────┬──────────────┐
│ Method  │ Route                        │ Middleware   │
├─────────┼──────────────────────────────┼──────────────┤
│ GET     │ /users                       │ 1            │
│ POST    │ /users                       │ 2            │
│ DELETE  │ /api/users/:id               │ 2            │
└─────────┴──────────────────────────────┴──────────────┘
```

---
