# The Onion Execution Model

Middleware in Volten executes in a cascading "onion" flow:

1. **Downstream Phase**: Middlewares execute from outer to inner in the order they were registered.
2. **Terminal Handler**: The route handler processes the request and prepares the response.
3. **Upstream Phase**: Once `await next()` resolves, control flows back in reverse order (from inner to outer), allowing earlier middlewares to inspect or finalize the response.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant M1 as Logger Middleware
    participant M2 as Auth Guard
    participant Handler as Route Handler

    Client->>M1: HTTP Request
    Note over M1: Record start timestamp
    M1->>M2: await next()
    Note over M2: Validate user credentials
    M2->>Handler: await next()
    Note over Handler: Execute business logic & send response
    Handler-->>M2: Return from next()
    Note over M2: Optional post-handler logic
    M2-->>M1: Return from next()
    Note over M1: Calculate duration & log response time
    M1-->>Client: HTTP Response
```

### Timing Requests Example

```typescript
import { App } from 'volten';

const app = new App();

app.use(async (ctx, next) => {
  const start = Date.now();

  // Wait for all downstream middlewares and the route handler to finish
  await next();

  // Runs on the return trip
  const duration = Date.now() - start;
  ctx.setHeader('X-Response-Time', `${duration}ms`);
  console.log(`${ctx.method} ${ctx.url} - ${ctx.statusCode} (${duration}ms)`);
});
```

---