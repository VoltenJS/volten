# Common Middleware Patterns

### 1. Simple CORS Middleware

```typescript
const cors = (ctx) => {
  ctx.setHeader("Access-Control-Allow-Origin", "*");
  ctx.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH");
  ctx.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

app.preflight(cors);
```

### 2. Error Boundary Middleware

You can catch downstream exceptions within middleware using standard `try ... catch` blocks:

```typescript
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    console.error("Caught in middleware:", err);
    if (!ctx.headersSent) {
      ctx.status(500).json({
        error: "An unexpected error occurred",
        message: err.message,
      });
    }
  }
});
```

::: tip Global Error Handler
For centralized application-wide error handling, see the [Error Handling Guide](/guide/error-handling).
:::
