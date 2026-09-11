<script setup>
const dualRuntimeItems = [
  // Properties
  { property: 'ctx.method', type: 'string', default: 'string', description: 'HTTP method (e.g. "GET")', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.url', type: 'string', default: 'string', description: 'Full request URL path and query string', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.path', type: 'string', default: 'string', description: 'URL path without query string', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.query', type: 'Record<string, string | string[]>', default: 'Record<string, string | string[]>', description: 'Parsed query parameters', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.params', type: 'Record<string, string>', default: 'Record<string, string>', description: 'URL path parameters (e.g. :id)', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.state', type: 'Record<string, unknown>', default: 'Record<string, unknown>', description: 'Per-request state object for middleware', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.headers', type: 'Record<string, string | string[]>', default: 'Record<string, string>', description: 'Incoming request headers', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.cookies', type: 'Record<string, string>', default: 'Record<string, string>', description: 'Parsed cookies object', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.ip', type: 'string', default: 'string', description: 'Client IP address', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.hostname', type: 'string', default: 'string', description: 'Request hostname', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.host', type: 'string', default: 'string', description: 'Request host (includes port)', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.runtime', type: '"node"', default: '"edge"', description: 'Current runtime environment indicator', badge: 'Universal', badgeType: 'tip' },
  
  // Platform specific objects
  { property: 'ctx.req', type: 'http.IncomingMessage', default: 'Request (Web API)', description: 'The underlying request object.', badge: 'Platform Specific', badgeType: 'info' },
  { property: 'ctx.res', type: 'http.ServerResponse', default: 'null', description: 'The underlying response object.', badge: 'Platform Specific', badgeType: 'warning' },
  { property: 'ctx.env', type: 'null', default: 'unknown', description: 'Cloudflare Workers / Edge environment bindings.', badge: 'Platform Specific', badgeType: 'info' },
  { property: 'ctx.executionCtx', type: 'null', default: 'unknown', description: 'Edge ExecutionContext (e.g. ctx.waitUntil).', badge: 'Platform Specific', badgeType: 'info' },

  // Response Methods
  { property: 'ctx.send(data)', type: 'Writes to ServerResponse', default: 'Resolves Response object', description: 'Sends plaintext, HTML, or Buffer payloads.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.json(data)', type: 'Streams via JitCache', default: 'Resolves Response.json()', description: 'High-performance JSON serialization.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.text(data)', type: 'Writes to ServerResponse', default: 'Resolves text Response', description: 'Sends plaintext payload.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.buffer(data)', type: 'Writes to ServerResponse', default: 'Resolves ArrayBuffer Response', description: 'Sends binary payload.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.status(code)', type: 'Sets res.statusCode', default: 'Sets internal edgeStatus', description: 'Sets the HTTP response status code.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.setHeader(k, v)', type: 'res.setHeader()', default: 'Headers.set()', description: 'Sets an outgoing response header.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.getHeader(k)', type: 'res.getHeader()', default: 'Headers.get()', description: 'Gets an outgoing response header.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.removeHeader(k)', type: 'res.removeHeader()', default: 'Headers.delete()', description: 'Removes an outgoing response header.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.setCookie(n, v, opt)', type: 'Appends Set-Cookie header', default: 'Appends Set-Cookie header', description: 'Sets an outgoing cookie.', badge: 'Universal', badgeType: 'tip' },

  // Request Body
  { property: 'ctx.body(type?)', type: 'Reads & parses stream', default: 'Calls req.json() / req.text()', description: 'Parses JSON, Form-Data, or Text body.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.multipart()', type: 'Custom Node.js parser', default: 'req.formData() generator', description: 'Async generator for multipart/form-data uploads.', badge: 'Universal', badgeType: 'tip' },
  { property: 'ctx.bodyStream', type: 'req as ReadableStream', default: 'req.body', description: 'Raw byte stream of the request body.', badge: 'Universal', badgeType: 'tip' },
  
  // Node.js specific features
  { property: 'ctx.sendFile(path)', type: 'Streams file from disk', default: 'Throws Error', description: 'Streams a static file to the client.', badge: 'Node.js Only', badgeType: 'warning' },
  { property: 'ctx.download(path)', type: 'Streams file as download', default: 'Throws Error', description: 'Forces a file download.', badge: 'Node.js Only', badgeType: 'warning' }
];
</script>

# Dual Runtime Portability

Whether running on **Node.js** via `app.listen()` or in **Edge environments** (Cloudflare Workers, Bun, Deno) via `app.createFetch()`, the exact same `ctx` methods and properties work seamlessly without requiring code modifications:

<ApiTable
  title="Dual Runtime Portability"
  description="Cross-runtime behavior of RequestContext methods and properties"
  propertyHeader="Property / Method"
  typeHeader="Node.js Runtime"
  defaultHeader="Edge Runtime"
  :items="dualRuntimeItems"
/>

---
