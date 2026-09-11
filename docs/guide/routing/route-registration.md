# Route Registration

Route handlers are registered directly on your application instance or on a sub-router using standard HTTP method verbs:

- `app.get(path, ...handlers)`
- `app.post(path, ...handlers)`
- `app.put(path, ...handlers)`
- `app.patch(path, ...handlers)`
- `app.delete(path, ...handlers)`

### Basic Example

```typescript
import { App } from 'volten';

const app = new App();

// GET endpoint
app.get('/users', (ctx) => {
  return ctx.json({ users: [] });
});

// POST endpoint
app.post('/users', async (ctx) => {
  const body = await ctx.body();
  return ctx.status(201).json({ created: true, data: body });
});

// PUT endpoint
app.put('/users/:id', async (ctx) => {
  const body = await ctx.body();
  return ctx.json({ updated: true, id: ctx.params.id, data: body });
});

// PATCH endpoint
app.patch('/users/:id', async (ctx) => {
  const body = await ctx.body();
  return ctx.json({ patched: true, id: ctx.params.id, data: body });
});

// DELETE endpoint
app.delete('/users/:id', (ctx) => {
  return ctx.status(200).json({ deleted: true, id: ctx.params.id });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

---