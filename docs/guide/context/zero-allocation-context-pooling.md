# Zero-Allocation Context Pooling

To maximize throughput and eliminate Garbage Collection (GC) pauses under high concurrency, Volten implements **Context Pooling**:

- A pool of `RequestContext` objects is pre-allocated upon server startup.
- When an incoming request arrives, an idle context is retrieved from the pool.
- Once the response completes, `ctx.reset()` clears all request-specific fields, headers, and `ctx.state`, returning the context back to the pool.
- **Result**: Zero object allocations per request for the context lifecycle.

---
