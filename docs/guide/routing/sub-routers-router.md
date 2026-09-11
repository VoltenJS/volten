# Sub-Routers (Router)

As your application grows, you can modularize routes into separate files using the `Router` class.

### Creating and Mounting a Sub-Router

```typescript
// routes/users.ts
import { Router } from "volten";

export const userRouter = new Router();

userRouter.get("/", (ctx) => {
  return ctx.json({ users: [] });
});

userRouter.get("/:id", (ctx) => {
  return ctx.json({ user: { id: ctx.params.id } });
});

userRouter.post("/", async (ctx) => {
  const body = await ctx.body();
  return ctx.status(201).json({ created: true, body });
});
```

Mount the router onto the main `App` instance using `app.use()`:

```typescript
// app.ts
import { App } from "volten";
import { userRouter } from "./routes/users.js";

const app = new App();

// Mount with a prefix path
app.use("/api/users", userRouter);

// Now responds to:
// GET  /api/users
// GET  /api/users/:id
// POST /api/users
```

### Mounting Without a Prefix

You can also mount a router without a prefix path:

```typescript
const healthRouter = new Router();

healthRouter.get("/ping", (ctx) => ctx.send("pong"));
healthRouter.get("/health", (ctx) => ctx.json({ status: "ok" }));

app.use(healthRouter);
// Responds directly to /ping and /health
```

### Nested Sub-Routers

Routers can be nested to any depth:

```typescript
import { App, Router } from "volten";

const app = new App();
const apiRouter = new Router();
const v1Router = new Router();
const postsRouter = new Router();

postsRouter.get("/", (ctx) => ctx.json({ posts: [] }));
postsRouter.get("/:id", (ctx) => ctx.json({ id: ctx.params.id }));

// Nest postsRouter under v1Router -> /v1/posts
v1Router.use("/posts", postsRouter);

// Nest v1Router under apiRouter -> /api/v1/posts
apiRouter.use("/v1", v1Router);

// Mount apiRouter to the main app
app.use("/api", apiRouter);

// Accessible at:
// GET /api/v1/posts
// GET /api/v1/posts/:id
```

### Router-Level Middleware

Middleware registered on a router using `router.use()` applies to all routes defined on that router as well as any mounted child routers:

```typescript
const adminRouter = new Router();

// Router-scoped middleware
adminRouter.use((ctx, next) => {
  if (!ctx.headers["authorization"]) {
    return ctx.status(401).send("Unauthorized");
  }
  return next();
});

adminRouter.get("/dashboard", (ctx) => {
  return ctx.json({ view: "dashboard" });
});

adminRouter.get("/settings", (ctx) => {
  return ctx.json({ view: "settings" });
});

app.use("/admin", adminRouter);
```

---
