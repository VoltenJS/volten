# Global Middleware

Global middleware runs for every request entering your application. Register global middleware using `app.use()`:

```typescript
import { App } from "volten";

const app = new App();

// 1. Logging middleware
app.use(async (ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.path}`);
  await next();
});

// 2. Security headers middleware
app.use(async (ctx, next) => {
  ctx.setHeader("X-Content-Type-Options", "nosniff");
  ctx.setHeader("X-Frame-Options", "DENY");
  await next();
});

// Registering multiple middlewares in a single call
app.use(middlewareA, middlewareB, middlewareC);
```

---
