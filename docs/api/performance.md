# Performance & Architecture

Volten includes several implementation techniques intended to reduce request-processing work. This page describes what the code does; it does not claim that every technique improves every workload. Performance depends on runtime, route shape, handler behavior, payloads, configuration, and hardware. Use the repository's benchmark scripts and compare the workloads that matter to your application.

## Route matching

Volten stores routes in a radix tree. During route-tree preparation, Node.js builds a matcher from the tree using dynamic function construction when the runtime permits it. For case-sensitive matching without a query string, eligible static routes can take a generated method/path-length switch fast path. Other requests use the compiled radix-tree matcher. Edge mode uses the tree matcher rather than generating this Node.js matcher.

This is a conditional fast path, not a universal constant-time guarantee: query strings, case-insensitive matching, dynamic parameters, wildcards, and route-tree shape affect which path is used and how much work matching requires.

## Route execution plans

Each registered route receives an internal execution plan. The current builder selects:

- `OPTIMIZED`: one effective handler; dispatches directly to a single-handler executor.
- `GENERIC`: multiple effective handlers; uses the composed handler chain.

`SPECIALIZED` is present in the exported `ExecutionLevel` type but is not currently emitted by the plan builder. The public `app.inspectRoute(method, path)` method returns a frozen metadata snapshot with the route's level and counts, without exposing handler functions or dispatch internals. It rebuilds the route tree to reflect current route registrations, so use it for diagnostics rather than in a request hot path. See [Route Inspection](/guide/routing/route-inspection).

## Edge URL extraction

When an `EdgeRequestContext` is initialized, Volten uses `extractEdgePathAndSearch()` to extract the pathname and query string from common absolute HTTP(S) request URLs without always constructing a WHATWG `URL`. Inputs that need URL-standard normalization fall back to `new URL()`. This is an internal optimization; it does not change the public `ctx.url`, `ctx.path`, or query API contract.

## Request context pooling

An `App` pre-allocates `RequestPoolSize` Node and Edge context objects. Available contexts are reused and reset. If the Node pool is exhausted, Volten returns `503 Service Unavailable` with a closing connection; if the Edge pool is exhausted, a temporary context is created. Pooling can reduce context setup and allocation work, but it does not make the entire request path allocation-free.

## Middleware composition

Volten composes route handlers when routes are registered. On Node.js, `compileMiddlewareChain()` may use `new Function()` to construct a composed executor. In Edge mode, Volten uses `createDynamicMiddlewareChain()` instead. A single-handler route can use the direct executor described above; multi-handler routes retain the composed chain. These mechanisms aim to reduce composition overhead but should be benchmarked against the target workload.

## JSON serialization

Volten includes a shape-aware JSON stringifier and a cache for compiled serializers. The implementation can fall back to native `JSON.stringify()` when compilation is unavailable or a compiled serializer cannot be used. Do not assume a fixed speedup for all data shapes; compare representative payloads using the benchmark suite.

## Adaptive Traffic Triage

When enabled, Adaptive Traffic Triage monitors event-loop delay and uses the configured route priority to decide whether to shed traffic in `WARNING` or `CRITICAL` states. Shed requests receive `503 Service Unavailable`. This is overload mitigation, not a rate limiter or a guarantee that critical requests can never fail.

See [Configuration](/api/configuration), [Adaptive Traffic Triage](/guide/adaptive-traffic-triage), and [Route Options](/guide/routing/route-options).
