# Short-Circuiting the Pipeline

To halt execution and prevent downstream middlewares or route handlers from running, **send a response and do not call `next()`**:

```typescript
const rateLimiter = (ctx, next) => {
  const clientIp = ctx.ip;

  if (isRateLimited(clientIp)) {
    // Pipeline stops here; downstream handlers are NEVER called
    return ctx.status(429).json({ error: "Too Many Requests" });
  }

  // Proceed normally
  return next();
};

app.use(rateLimiter);
```

---
