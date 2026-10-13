# Adaptive Traffic Triage Priority

Volten includes an optional **Adaptive Traffic Triage (ATT) Engine** that monitors Node.js event-loop delay and sheds requests by configured route priority when the application enters a degraded triage state. ATT is load shedding, not a scheduler: it does not queue requests or guarantee that high-priority work succeeds.

Unlike request-count-based rate limiting, ATT uses Node.js **event-loop delay** from `node:perf_hooks` to choose when to shed traffic. When enabled and in a degraded state, the engine can return `503 Service Unavailable` for routes whose priorities should be shed. This may reduce load, but it cannot guarantee that the process stays responsive or that critical requests succeed.

---

## How It Works

The Adaptive Engine evaluates event-loop delay on the configured interval (default `checkIntervalMs: 500`) and when request handling invokes a state evaluation:

1. **NORMAL**: Event-loop delay is below the warning threshold; ATT does not shed requests.
2. **WARNING**: Event-loop delay exceeds `warningThresholdMs` (default: 40ms); `low` priority routes are eligible to be shed.
3. **CRITICAL**: Event-loop delay exceeds `criticalThresholdMs` (default: 100ms); `low` and `normal` priority routes are eligible to be shed. `critical` priority routes are not shed by this priority policy, but can still fail for other reasons.

When requests are dropped, Volten instantly responds with a `503 Service Unavailable: Server at capacity`, bypassing middleware and routing overhead entirely.

---

## Enabling Adaptive Triage

Adaptive triage is opt-in. You enable it when instantiating your Volten application by passing `adaptiveTriage` configurations:

```typescript
import { App } from "volten";

const app = new App({
  adaptiveTriage: {
    enabled: true, // Enable the triage engine
    warningThresholdMs: 50, // Lag threshold for WARNING state (ms)
    criticalThresholdMs: 150, // Lag threshold for CRITICAL state (ms)
    checkIntervalMs: 500, // How often to evaluate loop delay (ms)
  },
});
```

> [!NOTE]
ATT is based on Node.js `node:perf_hooks` and is intended for the Node.js server. Do not assume that the same monitoring behavior is available when using `app.createFetch()` in an Edge runtime.

---

## Setting Route Priorities

You assign a `priority` to a route during registration using the route options object.

```typescript
// 1. Critical priority (not shed by ATT's priority policy)
app.get("/health", { priority: "critical" }, (ctx) => {
  return ctx.json({ status: "ok" });
});

// 2. Normal Priority (Default for all routes)
app.post("/api/checkout", (ctx) => {
  return ctx.send("Payment processed");
});

// 3. Low Priority (Dropped first when the server gets busy)
app.get("/api/analytics/export", { priority: "low" }, (ctx) => {
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

Volten's **Adaptive Traffic Triage** uses event-loop delay as an overload signal and sheds configured priorities when thresholds are exceeded. It complements rather than replaces rate limiting, admission control, timeouts, and capacity planning.
