# Middleware

Volten supports global middleware, router-scoped middleware, and route-specific handlers. Middleware follows an onion-style execution model when it awaits `next()`: code before `await next()` runs before downstream handlers, and code after it runs as the downstream pipeline completes.

Volten composes middleware chains during route registration rather than rebuilding the chain for every request. On Node.js, the chain can use dynamic function compilation when available; Edge runtimes use a non-`new Function` execution path. A route with one effective handler can use a direct execution plan, while routes with multiple handlers use the composed chain. These are implementation optimizations, not a promise of zero runtime overhead.

See [The Middleware Signature](/guide/middleware/the-middleware-signature), [The Onion Execution Model](/guide/middleware/the-onion-execution-model), and [High-Performance Compiled Chains](/guide/middleware/high-performance-compiled-chains).
