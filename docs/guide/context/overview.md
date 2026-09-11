# Overview

<script setup>
const dualRuntimeItems = [
  {
    property: 'ctx.method, ctx.url, ctx.path',
    type: 'IncomingMessage',
    default: 'Web Request',
    description: 'Extracted directly from underlying request descriptors.'
  },
  {
    property: 'ctx.headers',
    type: 'Record<string, string>',
    default: 'Normalized Headers',
    description: 'Node lowercase headers dictionary or normalized Web Headers representation.'
  },
  {
    property: 'ctx.params',
    type: 'Record<string, string>',
    default: 'Record<string, string>',
    description: 'Captured parameters from radix routing hot paths.'
  },
  {
    property: 'ctx.query',
    type: 'Record<string, string | string[]>',
    default: 'Record<string, string | string[]>',
    description: 'Fast, lazy-parsed URL query string key-value dictionary.'
  },
  {
    property: 'ctx.cookies',
    type: 'Record<string, string>',
    default: 'Record<string, string>',
    description: 'Lazy-parsed Cookie header object without external middleware.'
  },
  {
    property: 'ctx.send(), ctx.json(), ctx.text()',
    type: 'ServerResponse',
    default: 'Web Response',
    description: 'Dispatches payload directly to Node HTTP socket or wraps in a standard Web Response.'
  },
  {
    property: 'ctx.bodyStream',
    type: 'ReadableStream',
    default: 'Request.body',
    description: 'Web standard ReadableStream<Uint8Array> across both runtimes.'
  },
  {
    property: 'ctx.req / ctx.rawReq',
    type: 'http.IncomingMessage',
    default: 'Request',
    description: 'Direct handle to the underlying runtime request instance.'
  },
  {
    property: 'ctx.res / ctx.rawRes',
    type: 'http.ServerResponse',
    default: 'null',
    description: 'Raw Node.js ServerResponse handle (null on Edge worker runtimes).'
  }
];

const cookieOptionsItems = [
  {
    property: 'httpOnly',
    type: 'boolean',
    default: 'false',
    description: 'Flags cookie as inaccessible to client-side scripts (`document.cookie`) for XSS protection.'
  },
  {
    property: 'secure',
    type: 'boolean',
    default: 'false',
    description: 'Transmits cookie exclusively over secure HTTPS connections.'
  },
  {
    property: 'sameSite',
    type: "'lax' | 'strict' | 'none'",
    default: "'lax'",
    description: 'Controls cross-site cookie transmission policy for CSRF mitigation.'
  },
  {
    property: 'maxAge',
    type: 'number',
    default: '-',
    description: 'Cookie lifetime duration in seconds (sets `Max-Age` header directive).'
  },
  {
    property: 'expires',
    type: 'Date',
    default: '-',
    description: 'Explicit GMT expiration date timestamp (sets `Expires` header directive).'
  },
  {
    property: 'path',
    type: 'string',
    default: "'/'",
    description: 'URL path scope for which the cookie is valid.'
  },
  {
    property: 'domain',
    type: 'string',
    default: '-',
    description: 'Host and subdomain scope for cookie transmission.'
  }
];
</script>

# Context (`ctx`)

In Volten, every incoming HTTP request is encapsulated in a **`RequestContext`** instance, commonly referred to as **`ctx`**.

The `ctx` object provides a unified, cross-runtime API for reading request headers, parameters, query strings, and body payloads, as well as sending responses, setting cookies, streaming data, and managing per-request state.

---
