# Wildcards & Catch-All Routes ()

Use an asterisk (`*`) to capture any trailing path sequence. The captured path segment is available on `ctx.params['*']`:

```typescript
// Matches /static/css/main.css, /static/images/logo.png, etc.
app.get('/static/*', (ctx) => {
  const assetPath = ctx.params['*'];
  return ctx.json({
    status: 'success',
    assetPath,
  });
});
```

### Catch-All Fallback

You can use wildcards at the root or route level to implement custom 404 handlers or single-page application (SPA) fallbacks:

```typescript
// SPA client-side routing fallback
app.get('/*', (ctx) => {
  return ctx.sendFile('./public/index.html');
});
```

::: info Priority Resolution
Volten's router prioritizes static segments first, followed by parameter segments (`:param`), and finally wildcards (`*`). If a static route matches, it will be executed over a wildcard route.
:::

---