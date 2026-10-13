# Route Inspection

`app.inspectRoute(method, path)` returns read-only metadata about the route that matches the supplied HTTP method and path. It is useful when diagnosing route compilation and handler-chain selection.

## Example

```typescript
import { App } from "volten";

const app = new App();
app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));

const info = app.inspectRoute("GET", "/users/123");
if (info) {
  console.log(info.level); // "OPTIMIZED"
  console.log(info.paramCount); // 1
  console.log(info.effectiveHandlerCount); // 1
}
```

## Return Value

The method returns `RouteExecutionInfo` or `null` when no route matches. The metadata fields are:

| Field | Meaning |
| --- | --- |
| `id` | Internal execution-plan identifier; not stable across route-tree rebuilds. |
| `method` | Registered HTTP method for the matched route. |
| `path` | Registered route pattern. |
| `level` | Execution-plan level selected by the plan builder. |
| `paramCount` | Number of named parameter segments in the route pattern. |
| `effectiveHandlerCount` | Number of effective handlers in the route chain. |

The current plan builder emits `OPTIMIZED` for a route with exactly one effective handler and `GENERIC` for a route with multiple handlers. `SPECIALIZED` exists in the exported `ExecutionLevel` type but is not currently emitted by the builder.

The returned object is frozen and contains no handler references or executable dispatch functions. The method rebuilds the route tree so newly registered routes and mounted sub-router routes are included. Because of that rebuild, call it during diagnostics, not in a request handler or hot path.
