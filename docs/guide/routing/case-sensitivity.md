# Case Sensitivity

By default, Volten operates with **case-insensitive routing** (`caseInsensitive: true` in `VoltenAppOptions`).

```typescript
const app = new App({
  caseInsensitive: true, // Default
});

app.get('/users', (ctx) => {
  ctx.send('Matched!');
});

// All of the following match the same route:
// GET /users
// GET /Users
// GET /USERS
```

::: tip Preserving Parameter Casing
Even when case-insensitivity is enabled, Volten **preserves the exact original casing** of route parameter names and captured parameter values in `ctx.params`.
:::

---