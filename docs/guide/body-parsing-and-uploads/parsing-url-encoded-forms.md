# Parsing URL-Encoded Forms

When requests have a `content-type: application/x-www-form-urlencoded` header, `await ctx.body()` automatically activates Volten's specialized `fastParseUrlEncoded` parser:

```typescript
app.post('/login', async (ctx) => {
  const form = (await ctx.body()) as Record<string, string | string[]>;

  const username = form.username;
  const password = form.password;

  return ctx.json({ username });
});
```

- Handles plus signs `+` and percent-encoded characters correctly without external dependencies.
- Collects duplicate keys into an array (e.g. `tag=news&tag=tech` becomes `{ tag: ['news', 'tech'] }`).

---