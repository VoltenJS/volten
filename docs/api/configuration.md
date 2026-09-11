<script setup>
const voltenAppOptionsItems = [
  {
    property: 'bodyLimit',
    type: 'number',
    default: '1048576 (1 MB)',
    description: 'Maximum request payload size in bytes before returning 413 Payload Too Large.'
  },
  {
    property: 'caseInsensitive',
    type: 'boolean',
    default: 'true',
    description: 'Enables case-insensitive route matching in the radix router.'
  },
  {
    property: 'RequestPoolSize',
    type: 'number',
    default: '2048',
    description: 'Number of pre-allocated RequestContext instances in the memory pool for zero GC overhead.'
  },
  {
    property: 'noLogs',
    type: 'boolean',
    default: 'false',
    description: 'Suppresses internal framework warning and diagnostic logs.'
  },
  {
    property: 'https',
    type: 'VoltenHttpsOptions | undefined',
    default: 'undefined',
    description: 'TLS/SSL certificate configuration for native Node.js HTTPS server.'
  },
  {
    property: 'loggerOptions',
    type: 'CustomLoggerOptions',
    default: "{ level: 'warn' }",
    description: 'Configuration for the integrated high-performance structured JSON logger.'
  },
  {
    property: 'adaptiveTriage',
    type: 'AdaptiveTriageOptions',
    default: 'See details',
    description: 'Settings for real-time traffic shedding based on event-loop lag monitoring.'
  }
];

const httpsItems = [
  {
    property: 'key',
    type: 'string',
    required: true,
    description: 'The full private key string contents (e.g. read from privkey.pem).'
  },
  {
    property: 'cert',
    type: 'string',
    required: true,
    description: 'The full certificate chain string contents (e.g. read from fullchain.pem).'
  }
];

const adaptiveTriageItems = [
  {
    property: 'enabled',
    type: 'boolean',
    default: 'false',
    description: 'Enables real-time event loop latency monitoring and automated traffic load shedding.'
  },
  {
    property: 'warningThresholdMs',
    type: 'number',
    default: '40',
    description: 'Event loop delay in milliseconds triggering WARNING state (drops low priority requests).'
  },
  {
    property: 'criticalThresholdMs',
    type: 'number',
    default: '100',
    description: 'Event loop delay in milliseconds triggering CRITICAL state (drops low and normal priority requests).'
  },
  {
    property: 'resolutionMs',
    type: 'number',
    default: '10',
    description: 'Resolution in milliseconds of event loop delay histogram samples recorded via perf_hooks.'
  },
  {
    property: 'checkIntervalMs',
    type: 'number',
    default: '500',
    description: 'Interval in milliseconds between background health evaluation ticks.'
  }
];
</script>

# Configuration

Volten applications are initialized and configured using the `VoltenAppOptions` object passed to the `App` constructor. This document details all available configuration options, their defaults, and best practices.

## Basic Usage

```typescript
import { App } from "volten";

const app = new App({
  bodyLimit: 2 * 1024 * 1024, // 2MB limit
  caseInsensitive: true,
  RequestPoolSize: 4096,
  noLogs: false,
});
```

---

## `VoltenAppOptions` Reference

```typescript
export type VoltenAppOptions<CustomLevels extends string = never> = {
  bodyLimit?: number;
  caseInsensitive?: boolean;
  RequestPoolSize?: number;
  noLogs?: boolean;
  https?: VoltenHttpsOptions | undefined;
  loggerOptions?: CustomLoggerOptions<CustomLevels>;
  adaptiveTriage?: AdaptiveTriageOptions;
};
```

### Options Overview

<ApiTable
  title="VoltenAppOptions"
  description="Core options passed to new App(options)"
  :items="voltenAppOptionsItems"
/>

---

## Option Details

### `RequestPoolSize`

- **Type**: `number`
- **Default**: `2048`

Volten utilizes an advanced object pooling architecture for request lifecycles. Instead of instantiating new request and response wrapper objects on every HTTP request, Volten pre-allocates a fixed pool of `RequestContext` instances (`NodeRequestContext` and `EdgeRequestContext`) at application startup.

#### How It Works

1. Upon `new App()`, Volten initializes `RequestPoolSize` context instances and keeps them in an internal queue.
2. When a request arrives, a context is popped from the pool in $O(1)$ time and initialized with the active socket/request streams.
3. When the response finishes or connection closes (`res.on('close')`), the context is thoroughly reset and returned to the pool.

#### Pool Exhaustion

If concurrent requests exceed the pool size:

- **Node.js**: The server immediately responds with `503 Service Unavailable` (`Connection: close`) to avoid unbounded memory allocation and process crashes.
- **Edge / Fetch**: A transient fallback context is created dynamically.

```typescript
const app = new App({
  // Scale up for high-concurrency environments with adequate memory
  RequestPoolSize: 8192,
});
```

> [!TIP]
> Tune `RequestPoolSize` according to your expected concurrent connections. For high-traffic production workloads with thousands of concurrent connections, setting `RequestPoolSize: 4096` or `8192` ensures zero garbage collection overhead.

---

### `https`

- **Type**: `VoltenHttpsOptions | undefined`
- **Default**: `undefined`

Configures the underlying Node.js server to run as a native `https.Server` with TLS encryption.

```typescript
export type VoltenHttpsOptions = {
  /** The full private key as a string */
  key: string;
  /** The full certificate as a string */
  cert: string;
};
```

<ApiTable
  title="VoltenHttpsOptions"
  description="TLS/SSL certificate configuration for native Node.js HTTPS server"
  :items="httpsItems"
/>

#### Example: HTTPS Server

```typescript
import { App } from "volten";
import fs from "node:fs";

const app = new App({
  https: {
    key: fs.readFileSync("./certs/privkey.pem", "utf8"),
    cert: fs.readFileSync("./certs/fullchain.pem", "utf8"),
  },
});

app.get("/", (ctx) => {
  ctx.send("Serving securely over HTTPS!");
});

app.listen(8443, () => {
  console.log("HTTPS server listening on https://localhost:8443");
});
```

When `https` is provided, Volten delegates server creation to Node's `https.createServer(...)`. If omitted, standard `http.createServer(...)` is used.

---

### `bodyLimit`

- **Type**: `number`
- **Default**: `1048576` (1 MB in bytes)

Defines the maximum allowed byte size for incoming request bodies (e.g., JSON, URL-encoded, or raw buffers).

#### Fast Early Rejection

When an incoming request arrives, Volten performs an instant check on the `Content-Length` header before buffering any chunks into memory. If `Content-Length` exceeds `bodyLimit`, the request socket is paused and Volten terminates the request with `413 Payload Too Large`.

For chunked transfer encoding (where `Content-Length` may not be present), the internal body parsers enforce this limit continuously while consuming the stream.

```typescript
const app = new App({
  // Increase limit to 10MB for file uploads or large JSON payloads
  bodyLimit: 10 * 1024 * 1024,
});
```

> [!NOTE]
> You can also override the body limit per individual route using route options:
>
> ```typescript
> app.post("/upload", { bodyLimit: 50 * 1024 * 1024 }, async (ctx) => {
>   const body = await ctx.body();
>   ctx.json({ received: true });
> });
> ```

---

### `caseInsensitive`

- **Type**: `boolean`
- **Default**: `true`

Controls whether URL path matching in the radix router is case-insensitive.

- When `true`: `/Users/Profile` and `/users/profile` resolve to the same handler.
- When `false`: Paths are treated with strict casing.

```typescript
const app = new App({
  caseInsensitive: false, // Strict case sensitivity
});
```

---

### `noLogs`

- **Type**: `boolean`
- **Default**: `false`

Silences framework-level diagnostic and warning outputs printed to `console.error` and `console.warn` (such as unhandled error fallbacks or custom error handler warnings).

```typescript
const app = new App({
  noLogs: process.env.NODE_ENV === "test", // Clean output during automated testing
});
```

---

### `loggerOptions`

- **Type**: `CustomLoggerOptions<CustomLevels>`
- **Default**: `{ level: 'warn' }`

Configures the built-in high-performance structured JSON logger. For detailed documentation on logger levels, serializers, mixins, and redaction, refer to the [Logging API Reference](/api/logging).

```typescript
const app = new App({
  loggerOptions: {
    level: "info",
    pretty: process.env.NODE_ENV !== "production",
    redact: ["password", "authorization"],
  },
});
```

---

### `adaptiveTriage`

- **Type**: `AdaptiveTriageOptions`
- **Default**:
  ```typescript
  {
    enabled: false,
    warningThresholdMs: 40,
    criticalThresholdMs: 100,
    resolutionMs: 10,
    checkIntervalMs: 500,
  }
  ```

<ApiTable
  title="AdaptiveTriageOptions"
  description="Event loop delay monitoring and automated traffic load shedding options"
  :items="adaptiveTriageItems"
/>

Configures Volten's automated event loop health monitor and intelligent load shedding. For an in-depth breakdown of load-shedding states and route priority tagging, see the [Performance & Architecture Reference](/api/performance).

---

## Default Configuration Object

Volten exposes the default configuration constant `DefaultVoltenOptions`:

```typescript
import { DefaultVoltenOptions } from "volten";

console.log(DefaultVoltenOptions);
/*
{
  bodyLimit: 1048576,
  caseInsensitive: true,
  RequestPoolSize: 2048,
  noLogs: false,
  https: undefined,
  loggerOptions: {
    level: "warn"
  },
  adaptiveTriage: {
    enabled: false,
    warningThresholdMs: 40,
    criticalThresholdMs: 100,
    resolutionMs: 10,
    checkIntervalMs: 500
  }
}
*/
```
