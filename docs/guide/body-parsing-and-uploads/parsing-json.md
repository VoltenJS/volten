# Parsing JSON

To parse incoming JSON data, invoke `await ctx.body()` (or explicitly `await ctx.body('json')`) inside your route handler:

```typescript
import { App } from 'volten';

interface CreateUserDTO {
  name: string;
  email: string;
}

const app = new App();

app.post('/users', async (ctx) => {
  // Reads and parses JSON payload
  const payload = (await ctx.body()) as CreateUserDTO;

  return ctx.status(201).json({
    success: true,
    user: payload,
  });
});
```

### Key Behaviors
- **Content-Type Validation**: Volten checks the `content-type` header. If `application/json` is present, it parses the body with `JSON.parse`.
- **Empty Body Handling**: If the client provides `Content-Length: 0` or sends an empty body, `ctx.body()` resolves to an empty object `{}` rather than throwing a parsing exception.
- **Cache-on-Read**: The parsing promise is cached on the context. Calling `await ctx.body()` multiple times within the same request lifecycle returns the exact same parsed result without re-reading the stream.

---