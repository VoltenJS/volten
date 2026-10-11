# Context & Buffer Pooling

To maximize throughput and minimize Garbage Collection (GC) pauses under high concurrency, Volten implements **Context & Buffer Pooling** with strict request identity isolation:

- Heavy internal resources (such as the 64KB response buffer and write queues) are held in pooled internal storage objects (`ContextStorage`).
- Each request receives a lightweight, per-request context handle with an immutable request token bound to the underlying pooled storage.
- Request identity is completely decoupled from pooled mutable storage: stale references from previous requests can never observe or mutate subsequent requests sharing the underlying pool slot.
- Once both the response closes and the handler chain settles, the underlying storage is reset and returned to the pool.
- **Result**: Substantially reduced GC pressure and memory allocations without compromising cross-request isolation or correctness.

---
