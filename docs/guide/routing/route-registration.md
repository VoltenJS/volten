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

After registering routes and mounting sub-routers, call `app.printRoutes()` to log a table of the application's registered routes, including method, path, middleware count, and priority. This is a console diagnostic; it does not return route metadata.

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

The exact column widths and formatting depend on the registered routes.

---


## Inspecting a Route's Execution Plan

Use `app.inspectRoute(method, path)` to retrieve immutable metadata for the route that matches a method and path. It returns `null` when no route matches. The result contains `id`, `method`, `path`, `level`, `paramCount`, and `effectiveHandlerCount`; executable handlers and internal dispatch functions are not exposed.

```typescript
import { App } from "volten";

const app = new App();
app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));

const info = app.inspectRoute("GET", "/users/123");
if (info !== null) {
  console.log(info.level); // "OPTIMIZED" for this single-handler route
  console.log(info.paramCount); // 1
  console.log(info.effectiveHandlerCount); // 1
}
```

Current execution levels are `OPTIMIZED` for a route with one effective handler and `GENERIC` for a route with multiple handlers. `SPECIALIZED` is part of the exported level type but is not currently emitted by the plan builder. The `id` is an internal diagnostic identifier, not a stable identifier across route-tree rebuilds. `inspectRoute()` rebuilds the route tree to include mounted sub-routers and recently registered routes, so use it for diagnostics rather than on a per-request hot path.
