# Edge Compatibility

Volten is designed as a hybrid runtime framework. While offering zero-dependency native Node.js performance, it also runs natively in modern Edge runtimes (Cloudflare Workers, Vercel Edge Runtime, Fastly Compute, and WinterCG-compliant platforms) using the standard Web Fetch API (`Request`, `Response`, `Headers`, and `ReadableStream`).

---

## Universal Runtime Vision

Write your routes and business logic once using Volten's intuitive context API (`ctx`), and deploy the same application across:

- **Node.js** (via native `http` / `https` sockets)
- **Cloudflare Workers** (via `app.createFetch()`)
- **Vercel Edge Functions** (via Edge runtime)
- **Bun & Deno** (via standard Web Fetch APIs)

```typescript
import { App } from "volten";

const app = new App();

app.get("/api/greeting", (ctx) => {
  ctx.json({
    message: "Hello from Volten!",
    runtime: ctx.runtime, // 'node' | 'edge'
  });
});

// For Cloudflare Workers or Edge environments:
export default {
  fetch: app.createFetch(),
};
```

---

## Edge Runtime Detection (`isEdge.ts`)

Volten provides intelligent, zero-config environment sniffing in `src/utils/isEdge.ts`. The `isEdge()` utility executes a multi-factor detection strategy to determine if the active runtime lacks Node.js APIs or restricts dynamic code generation.

### Detection Heuristics

`isEdge()` evaluates the following conditions in priority order:

1. **Manual Override**: If `setIsEdge(boolean)` was explicitly set (e.g. in tests), that value is returned immediately.
2. **Vercel Edge Runtime**: Checks if `globalThis.EdgeRuntime` is a string.
3. **Cloudflare Workers Navigator**: Checks if `navigator.userAgent` contains `"Cloudflare-Workers"`.
4. **Cloudflare Workers Globals**: Checks for the existence of `globalThis.WebSocketPair`.
5. **Environment Variables**: Checks whether any of the following environment variables indicate an edge container:
   - `process.env.NEXT_RUNTIME === 'edge'`
   - `process.env.EDGE_RUNTIME === 'true'` or `'1'`
   - `process.env.VOLTEN_RUNTIME === 'edge'`
   - `process.env.NODE_ENV === 'edge'`
6. **Missing Process Global**: Detects environments where Node's `process` global is undefined (`typeof process === 'undefined'`).
7. **Eval Restriction Probe (`checkEvalBlocked`)**: Probes whether dynamic function construction is blocked:
   ```typescript
   try {
     new Function("");
     evalBlocked = false;
   } catch {
     evalBlocked = true;
   }
   ```
   If `new Function("")` throws an error due to platform security policies or Content Security Policy (CSP), `isEdge()` returns `true`.

---

## Dynamic Compilation & Fallbacks

Many Edge environments (like Cloudflare Workers and strict serverless containers) disable arbitrary code evaluation (`eval` and `new Function(...)`) for security reasons. Volten adapts dynamically based on `isEdge()`:

### 1. Middleware Pipeline (`compileMiddlewareChain`)

- **Node.js**: Volten JIT-compiles your route middleware stack using dynamic code generation (`new Function(...)`) into an optimized, flattened execution chain that eliminates closure allocations between `next()` calls.
- **Edge Runtime**: When `isEdge()` returns `true`, Volten automatically switches to `createDynamicMiddlewareChain()`. This uses an onion-model dispatch loop with index guards, providing identical middleware behavior (`await next()`) without requiring `new Function`.

```typescript
// src/core/compose.ts
export function compileMiddlewareChain(chain: VoltenHandler[]): VoltenChainHandler {
  if (isEdge()) {
    return createDynamicMiddlewareChain(chain);
  }
  // JIT compilation with new Function(...)
}
```

### 2. JSON Serialization (`voltJson` & `compileVoltJson`)

- **Node.js**: Shapes are fingerprinted and compiled into high-speed template string serializer functions.
- **Edge Runtime**: Bypasses dynamic compilation and seamlessly uses native `JSON.stringify()`.

---

## The `EdgeRequestContext`

When handling requests via `app.createFetch()`, Volten utilizes `EdgeRequestContext` instead of `NodeRequestContext`:

- **Web Request**: Accessible via `ctx.req` or `ctx.rawReq` as a native `Request`.
- **Standard Response**: Produces a native Web `Response` object accessible via `ctx._edgeResponsePromise`.
- **Return Value Ergonomics**: In addition to `ctx.send()` and `ctx.json()`, handlers in Edge mode can directly return values:
  ```typescript
  // Return an object (auto-serialized to JSON)
  app.get("/user", () => ({ id: 1, name: "Alice" }));

  // Return a string (text/plain)
  app.get("/status", () => "OK");

  // Return a raw Web standard Response
  app.get("/custom", () => new Response("custom", { status: 201 }));
  ```

---

## Deployment Examples

### Cloudflare Workers

```typescript
import { App } from "volten";

const app = new App();

app.get("/", (ctx) => {
  ctx.send("Hello from Cloudflare Workers!");
});

app.get("/env", (ctx) => {
  // Edge runtime bindings passed in env
  const apiKey = (ctx.env as Record<string, string>)?.["API_KEY"];
  ctx.json({ hasKey: Boolean(apiKey) });
});

export default {
  fetch: app.createFetch(),
};
```

### Vercel Edge Middleware / Functions

```typescript
import { App } from "volten";

export const config = {
  runtime: "edge",
};

const app = new App();

app.get("/api/edge", (ctx) => {
  ctx.json({ platform: "Vercel Edge" });
});

export default app.createFetch();
```

### Bun Native HTTP Server

```typescript
import { App } from "volten";

const app = new App();

app.get("/", (ctx) => {
  ctx.send("Running fast on Bun!");
});

export default {
  port: 3000,
  fetch: app.createFetch(),
};
```

---

## Testing & Overrides (`setIsEdge`)

For testing environments or specialized runtime wrappers, you can manually force or reset the edge detection state:

```typescript
import { isEdge, setIsEdge } from "volten"; // or from 'volten/utils'

// Force Edge mode
setIsEdge(true);
console.log(isEdge()); // true

// Force Node.js mode
setIsEdge(false);
console.log(isEdge()); // false

// Revert to automatic runtime detection
setIsEdge(null);
```
