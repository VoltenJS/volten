# Route Parameters (:param)

Dynamic segments are declared with a leading colon (`:`). When an incoming request matches the path pattern, Volten extracts each dynamic segment and populates `ctx.params`.

```typescript
// Single parameter
app.get('/users/:id', (ctx) => {
  const userId = ctx.params.id;
  return ctx.json({ userId });
});

// Multiple parameters
app.get('/teams/:teamId/projects/:projectId', (ctx) => {
  const { teamId, projectId } = ctx.params;
  return ctx.json({ teamId, projectId });
});
```

### TypeScript Parameter Autocompletion

Volten's router types automatically infer parameter keys from the route path string template:

```typescript
// TypeScript automatically infers ctx.params to have { id: string }
app.get('/users/:id', (ctx) => {
  const userId: string = ctx.params.id; // Fully typed!
  return ctx.send(`User: ${userId}`);
});
```

### Non-Shadowing Radix Matching

Volten's radix tree separates static branches, parameter branches, and wildcards. Routes sharing common prefixes or overlapping parameter positions do not shadow one another:

```typescript
app.get('/users/:id', (ctx) => {
  ctx.json({ type: 'user-detail', id: ctx.params.id });
});

app.get('/users/:username/profile', (ctx) => {
  ctx.json({ type: 'user-profile', username: ctx.params.username });
});

// GET /users/123          -> matches '/users/:id'
// GET /users/john/profile -> matches '/users/:username/profile'
```

---