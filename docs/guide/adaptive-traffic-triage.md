# Adaptive Traffic Triage Priority

Volten includes a built-in **Adaptive Traffic Triage Engine** that dynamically shapes incoming traffic to ensure high-priority requests are processed first during periods of heavy load.

Unlike traditional rate limiting (which blindly blocks traffic per IP), Volten actively monitors the underlying Node.js **Event Loop Delay** using `node:perf_hooks`. When the event loop becomes backed up due to high CPU load or concurrent I/O, Volten shifts into degraded states, automatically shedding low-priority traffic (returning `503 Service Unavailable`) to keep the server alive and responsive for critical paths.

---

## How It Works

The Adaptive Engine operates in three states, continuously evaluated every `checkIntervalMs` (default: 500ms):

1. **NORMAL**: Event loop lag is below `warningThresholdMs` (default: 40ms). All requests are processed normally.
2. **WARNING**: Event loop lag exceeds `warningThresholdMs`. 
   - **Action**: Drops `low` priority requests. `normal` and `critical` requests are processed.
3. **CRITICAL**: Event loop lag exceeds `criticalThresholdMs` (default: 100ms).
   - **Action**: Drops `low` and `normal` priority requests. Only `critical` requests (e.g., core API routes, health checks) are allowed through.

When requests are dropped, Volten instantly responds with a `503 Service Unavailable: Server at capacity`, bypassing middleware and routing overhead entirely.

---

## Enabling Adaptive Triage

Adaptive triage is opt-in. You enable it when instantiating your Volten application by passing `adaptiveTriage` configurations:

```typescript
import { App } from 'volten';

const app = new App({
  adaptiveTriage: {
    enabled: true,              // Enable the triage engine
    warningThresholdMs: 50,     // Lag threshold for WARNING state (ms)
    criticalThresholdMs: 150,   // Lag threshold for CRITICAL state (ms)
    checkIntervalMs: 500        // How often to evaluate loop delay (ms)
  }
});
```

> [!NOTE]
> In environments that do not support `node:perf_hooks` (e.g., some strict Edge environments), Volten will log a warning and run in a graceful fallback mode without crashing.

---

## Setting Route Priorities

You assign a `priority` to a route during registration using the route options object. 

```typescript
// 1. Critical Priority (Never dropped unless server dies entirely)
app.get('/health', { priority: 'critical' }, (ctx) => {
  return ctx.json({ status: 'ok' });
});

// 2. Normal Priority (Default for all routes)
app.post('/api/checkout', (ctx) => {
  return ctx.send('Payment processed');
});

// 3. Low Priority (Dropped first when the server gets busy)
app.get('/api/analytics/export', { priority: 'low' }, (ctx) => {
  // Heavy CPU/Database operation
  return ctx.json(generateHugeReport());
});
```

### Best Practices for Priorities

- **`critical`**: Use sparingly. Reserve for health checks, critical webhook receivers, and core infrastructure endpoints.
- **`normal`**: The default. Use for standard API traffic, user operations, and standard page loads.
- **`low`**: Use for heavy CPU-bound tasks, background exports, batch processing, polling, and non-essential features that can safely fail and retry later.

---

## Why this is better than Rate Limiting

Standard rate limiting blocks traffic based on arbitrary request counts (e.g., 100 requests per minute). If your server handles requests quickly, a rate limit might block users unnecessarily. Conversely, if 10 extremely complex requests saturate your CPU, a standard rate limit won't stop the server from crashing.

Volten's **Adaptive Traffic Triage** solves this by looking at *actual server health* (Event Loop Lag). It only sheds load when the server is genuinely struggling, guaranteeing maximum throughput.
