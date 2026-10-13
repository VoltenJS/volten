# Request Context Pooling

Volten pre-allocates a pool of `NodeRequestContext` and `EdgeRequestContext` objects when an `App` instance is created. Requests reuse an available context where possible, and request-specific fields are reset before the context is returned to the pool.

Pooling can reduce repeated context-object allocation and setup work. It does **not** mean that handling a request performs zero allocations: URL parsing, headers, response objects, route parameters, body parsing, and application code may allocate objects or strings.

The pool size is controlled by `RequestPoolSize`. On Node.js, when the pool is exhausted, Volten responds with `503 Service Unavailable` and closes the connection rather than allocating an unbounded number of pooled contexts. In Edge mode, Volten creates a temporary context when the pool is empty.
