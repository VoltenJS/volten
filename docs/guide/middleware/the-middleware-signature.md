# The Middleware Signature

A Volten middleware function receives two arguments: the request context (`ctx`) and the `next` function:

```typescript
import type { RequestContext, Next } from 'volten';

async function myMiddleware(ctx: RequestContext, next: Next): Promise<void> {
  // 1. Code executed on the way IN (downstream phase)
  
  await next(); // Hand over control to the next handler
  
  // 2. Code executed on the way OUT (upstream phase)
}
```

- **`ctx`**: The [`RequestContext`](/guide/context) instance containing request metadata, parameters, headers, and response utilities.
- **`next`**: A callback function (`() => Promise<void> | void`) that invokes the next middleware or terminal route handler in the chain.

---