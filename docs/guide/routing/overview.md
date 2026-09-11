# Routing

Volten features a high-performance **Trie-based (radix tree)** routing engine designed for zero-allocation path lookup and minimal latency.

Whether running on Node.js with `app.listen()` or in an Edge environment (Cloudflare Workers, Bun, Deno) via `app.createFetch()`, Volten provides identical routing behavior and parameter matching.

---