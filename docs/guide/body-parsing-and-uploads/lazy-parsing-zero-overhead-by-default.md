# Lazy Parsing: Zero Overhead by Default

In traditional frameworks, global body-parsing middleware reads and parses incoming request streams for _every_ request—even when a route does not require a payload (such as `GET` or `HEAD` requests).

Volten takes a **lazy, on-demand** approach:

1. Incoming streams are **not buffered or parsed** until you explicitly call `await ctx.body()` or consume `ctx.bodyStream`.
2. Requests with `GET` or `DELETE` methods automatically return empty objects or strings without reading streams.
3. If an endpoint does not read the body, no CPU cycles or memory buffers are wasted.

---
