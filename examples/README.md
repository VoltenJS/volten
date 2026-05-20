# Volten Code Examples Directory

Welcome to the official Volten examples suite! This directory contains a curated step-by-step progression of self-contained examples designed to demonstrate the core architecture, performance mechanics, and developer experience (DX) of the Volten HTTP engine.

All examples are written using modern JavaScript/Node.js, are completely zero-dependency, and are fully commented to help framework contributors and application developers understand Volten's internals.

---

## The Example Map

| File                                                               | Module Title               | Primary Architectural Concept                                                                      |
| :----------------------------------------------------------------- | :------------------------- | :------------------------------------------------------------------------------------------------- |
| **[`01-hello-world.js`](./01-hello-world.js)**                     | Minimal Server Baseline    | Instantiating the engine, socket host listening, and immediate macro-task string serialization.    |
| **[`02-middleware.js`](./02-middleware.js)**                       | The Onion Execution Model  | Navigating upstream/downstream execution pipelines via asynchronous `next()` closure chains.       |
| **[`03-json-response.js`](./03-json-response.js)**                 | Payload Delivery & I/O     | Fast content-length calculations and direct V8 binary streaming of stringified payloads.           |
| **[`04-routing-and-wildcards.js`](./04-routing-and-wildcards.js)** | Radix Tree Navigation      | Deep dynamic parameter token parsing (`:id`) and multi-segment fallback catch-all routing (`**`).  |
| **[`05-global-error-handling.js`](./05-global-error-handling.js)** | Process Fault Tolerance    | Structuring application process error boundaries via the native, lifecycle-level `onError` hook.   |
| **[`06-static-file-serving.js`](./06-static-file-serving.js)**     | Stream Asset Pipelines     | Non-blocking file I/O operations, chunked buffer delivery, and content-type resolution.            |
| **[`07-body-parsing.js`](./07-body-parsing.js)**                   | Inbound Data Guards        | Adaptive body stream decoding (`JSON` with adaptive text fallbacks) and `bodyLimit` memory guards. |
| **[`08-cookies-and-sessions.js`](./08-cookies-and-sessions.js)**   | State Management Lifecycle | High-speed, single-pass inline cookie parsing and secure imperative `Set-Cookie` header emission.  |
| **[`09-stream-responses.js`](./09-stream-responses.js)**           | Backpressure Streaming     | Chunked transfer encodings, Server-Sent Events (SSE), and unblocking the primary V8 event loop.    |
| **[`10-cors-and-security.js`](./10-cors-and-security.js)**         | Multi-Origin Shields       | The high-performance `preflight()` hook for routing-bypass loops and OWASP header compliance.      |

---

## 🛠️ Getting Started & Execution

Before running the examples, make sure you build the code first by running:

```bash
npm run build
```

in the project root
