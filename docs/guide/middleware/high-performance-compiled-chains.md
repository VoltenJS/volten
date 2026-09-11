# High-Performance Compiled Chains

Unlike traditional frameworks that rely on runtime array slicing, recursive closures, or iterator allocations for every incoming request:

- **Node.js**: Volten dynamically compiles the middleware array into a single, flat, optimized JavaScript function via `compileMiddlewareChain`. This eliminates recursion and function-call overhead on hot paths.
- **Edge Runtimes**: In sandboxed edge environments (where `new Function` is disallowed), Volten uses an optimized dynamic runner (`createDynamicMiddlewareChain`).

---