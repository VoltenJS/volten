# Route Options

Every route registration method accepts an optional `RouteOptions` object as the second argument:

```typescript
app.METHOD(path, options, ...handlers);
```

<ApiTable
  title="RouteOptions"
  description="Per-route configuration options passed to app.METHOD(path, options, ...handlers)"
  :items="[
    {
      property: 'bodyLimit',
      type: 'number | null',
      default: 'null',
      description: 'Maximum request body size in bytes for this specific route. Overrides global `bodyLimit`.'
    },
    {
      property: 'priority',
      type: '\'critical\' | \'normal\' | \'low\'',
      default: '\'normal\'',
      description: 'Route priority tier used by Volten ATT engine under heavy server load.'
    }
  ]"
/>

### 1. Overriding Body Limits

You can configure a custom body limit per route. This is useful for restricting lightweight endpoints or expanding the limit for file uploads:

```typescript
// Small body limit (1 KB) for authentication
app.post("/auth/login", { bodyLimit: 1024 }, async (ctx) => {
  const creds = await ctx.body();
  return ctx.json({ success: true });
});

// Large body limit (20 MB) for document uploads
app.post("/documents/upload", { bodyLimit: 20 * 1024 * 1024 }, async (ctx) => {
  // Safe to receive up to 20MB
  return ctx.status(200).send("Upload complete");
});
```

### 2. Adaptive Traffic Triage Priority

Volten includes a built-in stress management engine called **Adaptive Traffic Triage (ATT)**. When enabled, Volten monitors event-loop lag and latency. Under severe load, it strategically drops low-priority requests to keep critical endpoints responsive:

```typescript
// CRITICAL: Never dropped, even under extreme load
app.get("/healthz", { priority: "critical" }, (ctx) => {
  return ctx.send("OK");
});

app.post("/webhooks/stripe", { priority: "critical" }, async (ctx) => {
  const event = await ctx.body();
  return ctx.json({ received: true });
});

// NORMAL (Default): Dropped only when server enters CRITICAL triage state
app.get("/api/products", { priority: "normal" }, (ctx) => {
  return ctx.json({ products: [] });
});

// LOW: Dropped early when server enters WARNING or CRITICAL triage states
app.post("/telemetry/events", { priority: "low" }, async (ctx) => {
  const events = await ctx.body();
  return ctx.status(204).send("");
});
```

---
