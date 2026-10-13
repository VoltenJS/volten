# Routing

Volten registers routes in a radix tree that supports static path segments, named parameters (such as `/users/:id`), and wildcards. On Node.js, Volten can compile a matcher from that tree; eligible static routes also have a generated fast path when case-sensitive matching is enabled and the request URL has no query string. Edge runtimes use the tree-based matcher.

The public routing API is shared across Node.js and Web Fetch entry points, but performance depends on the route shape, runtime, and application workload. See [Route Registration](/guide/routing/route-registration), [Route Options](/guide/routing/route-options), and [Route Inspection](/guide/routing/route-inspection).
