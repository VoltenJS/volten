# Guardrails & Execution Safety

Volten includes built-in execution checks to prevent common asynchronous pitfalls:

### 1. Double `next()` Prevention

Calling `next()` multiple times in the same middleware causes undefined behavior and race conditions in many frameworks. Volten detects this and throws `InvalidNextCallError`:

```typescript
app.use(async (ctx, next) => {
  await next();
  await next(); // Throws InvalidNextCallError!
});
```

### 2. Calling `next()` After Response Sent

If a response has already concluded (`ctx.sent === true`), invoking `next()` is rejected to prevent invalid wire writes:

```typescript
app.use(async (ctx, next) => {
  ctx.send("Completed");
  await next(); // Throws InvalidNextCallError!
});
```

---
