# Logging

Volten includes a zero-dependency, ultra-fast structured JSON logger designed for cloud observability platforms (Datadog, AWS CloudWatch, Google Cloud Logging, Grafana Loki).

The logger supports custom levels, dynamic level switching, sensitive data redaction, child loggers, custom property serializers, and dynamic mixin context.

---

## Quick Start

Every Volten application instance comes equipped with a built-in logger accessible via `app.logger`:

```typescript
import { App } from 'volten';

const app = new App();

app.get('/orders/:id', (ctx) => {
  app.logger.info({ orderId: ctx.params.id }, 'Processing order');
  ctx.json({ status: 'confirmed' });
});

app.listen(3000, () => {
  app.logger.info('Server running on port 3000');
});
```

When called, the logger outputs structured JSON lines to standard output:

```json
{"level":"info","pid":42110,"time":"2026-09-09T20:16:00.000Z","orderId":"123","msg":"Processing order"}
```

---

## Log Levels & Priorities

The built-in logger defines 6 standard severity levels with associated numeric priorities:

| Level | Priority | Description |
| :--- | :--- | :--- |
| `fatal` | `60` | Unrecoverable system failures requiring immediate intervention. |
| `error` | `50` | Runtime exceptions and critical request processing errors. |
| `warn` | `40` | Warning conditions and recoverable degradation. |
| `info` | `30` | Normal application flow, startup announcements, milestones. |
| `debug` | `20` | Detailed diagnostic messages useful during troubleshooting. |
| `trace` | `10` | Verbose step-by-step trace information. |

> [!NOTE]
> When standalone `createLogger()` is called with no options, its default level is `'info'`. When initialized via `new App()`, `DefaultVoltenOptions.loggerOptions.level` defaults to `'warn'` to keep production output lean.

---

## Configuration (`CustomLoggerOptions`)

You can configure the logger when creating your application, or create standalone logger instances using `createLogger`:

```typescript
export interface CustomLoggerOptions<CustomLevels extends string = never> {
  level?: DefaultLevels | CustomLevels;
  customLevels?: Record<CustomLevels, number>;
  redact?: string[];
  baseContext?: Record<string, unknown>;
  pretty?: boolean;
  mixin?: () => Record<string, unknown>;
  serializers?: Record<string, LoggerSerializerFn>;
  timestamp?: boolean | (() => string);
}
```

### Options Description

* **`level`**: Minimum threshold level to print. Any message with a priority lower than the active level will be discarded.
* **`customLevels`**: Key-value pairs defining custom log levels and their numeric priorities (e.g., `{ audit: 35 }`).
* **`redact`**: An array of object key names to sanitize. Matching fields anywhere in the logged object hierarchy will have their values replaced with `"[REDACTED]"`.
* **`baseContext`**: Static key-value pairs automatically merged into every log entry (e.g. `{ service: 'billing-api', env: 'production' }`).
* **`mixin`**: A callback returning dynamic properties evaluated on every log call (e.g. current memory usage, thread ID).
* **`serializers`**: Custom transformation functions applied to specific object keys before formatting.
* **`timestamp`**: Controls time stamping. `true` (default) generates an ISO 8601 string, `false` omits timestamps, or provide a custom function `() => string`.
* **`pretty`**: When set to `true`, formats JSON with 2-space indentation and newlines for local terminal readability.

---

## Configuration Examples

### Configuring via `new App()`

```typescript
import { App } from 'volten';

const app = new App({
  loggerOptions: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    pretty: process.env.NODE_ENV !== 'production',
    redact: ['password', 'token', 'creditCard'],
    baseContext: {
      service: 'payment-service',
      version: '1.2.0',
    },
  },
});
```

### Dynamic Configuration with `app.configLogger()`

You can reconfigure or upgrade the application's logger at any time using `app.configLogger()`:

```typescript
const app = new App();

// Reconfigure with custom log levels
type AppLevels = 'audit' | 'metric';

const customLogger = app.configLogger<AppLevels>({
  level: 'audit',
  customLevels: {
    metric: 25,
    audit: 45,
  },
});

customLogger.audit({ user: 'admin' }, 'Role changed');
```

---

## Logging Signatures & Usages

The logger supports three common invocation signatures:

### 1. Formatted Strings (`util.format`)
```typescript
app.logger.info('Connected to database at %s:%d', 'localhost', 5432);
// Output: {"level":"info","pid":1234,"time":"...","msg":"Connected to database at localhost:5432"}
```

### 2. Objects with Optional Messages
Object fields are merged directly into the top-level log payload:
```typescript
app.logger.info({ userId: 'u_101', role: 'admin' }, 'User logged in');
// Output: {"level":"info","pid":1234,"time":"...","userId":"u_101","role":"admin","msg":"User logged in"}
```

### 3. Error Objects
Errors passed as the first argument are automatically serialized into `{ type, message, stack, ...rest }`:
```typescript
try {
  throw new Error('Database connection failed');
} catch (err) {
  app.logger.error(err, 'Failed to connect on retry %d', 3);
}
// Output: {
//   "level": "error",
//   "pid": 1234,
//   "time": "...",
//   "err": {
//     "type": "Error",
//     "message": "Database connection failed",
//     "stack": "..."
//   },
//   "msg": "Failed to connect on retry 3"
// }
```

---

## Child Loggers (`logger.child()`)

Child loggers inherit all parent options, serializers, and redaction rules while binding additional contextual properties:

```typescript
import { App } from 'volten';

const app = new App();

// Preflight handler binding a child logger per request
app.preflight((ctx) => {
  const requestId = ctx.headers['x-request-id'] ?? crypto.randomUUID();
  ctx.state.log = app.logger.child({
    requestId,
    method: ctx.method,
    path: ctx.path,
  });
});

app.get('/api/resource', (ctx) => {
  const log = ctx.state.log;
  log.info('Fetching resource');
  // Log output automatically includes requestId, method, and path!
  ctx.json({ status: 'ok' });
});
```

---

## Serializers & Redaction

### Custom Serializers
Avoid serializing huge objects manually by providing serializers for known keys:

```typescript
import { createLogger } from 'volten';

const logger = createLogger({
  serializers: {
    // Only capture essential request properties
    req: (req: any) => ({
      method: req.method,
      url: req.url,
      ip: req.ip,
    }),
    user: (user: any) => ({
      id: user.id,
      email: user.email,
    }),
  },
});

logger.info({ req: ctx, user: currentUser }, 'Request processed');
```

### Deep Redaction
Volten searches nested objects and replaces sensitive keys with `"[REDACTED]"`:

```typescript
const logger = createLogger({
  redact: ['password', 'secret', 'authorization'],
});

logger.info({
  user: {
    name: 'Alice',
    password: 'super-secret-password',
  },
  headers: {
    authorization: 'Bearer eyJhbGciOi...',
  },
});
// The output object will replace password and authorization with "[REDACTED]"
```

---

## Standalone Usage

Volten's logger is completely standalone and can be imported and used anywhere in your application or CLI tools:

```typescript
import { createLogger } from 'volten'; // or import from 'volten/utils'

const logger = createLogger({
  level: 'info',
  pretty: true,
});

logger.info('Standalone logger initialized');
```
