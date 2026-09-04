import { App } from "../dist/index.js";

const PORT = process.env.PORT || 3000;

// =======================================================================
// 1. Initialize Volten with strict Adaptive Triage thresholds
// =======================================================================
const app = new App({
  adaptiveTriage: {
    enabled: true,
    warningThresholdMs: 15, // Drop "low" priority if event loop lags > 15ms
    criticalThresholdMs: 50, // Drop "normal/low" if lag > 50ms
  },
});

// =======================================================================
// 2. Critical VIP Route (Checkout) - MUST SURVIVE
// =======================================================================
app.post("/checkout", { priority: "critical" }, (ctx) => {
  ctx.json({ success: true, message: "Payment processed! 💰" });
});

// =======================================================================
// 3. Low Priority Route (The CPU Hog)
// =======================================================================
app.get("/heavy-export", { priority: "low" }, (ctx) => {
  // Simulate 10ms of heavy, synchronous CPU work per request
  // (e.g., massive JSON serialization, crypto hashing, or poor regex)
  const start = Date.now();
  while (Date.now() - start < 10) {}
  ctx.json({ message: "Export finished 📊" });
});

// =======================================================================
// 4. Start Server
// =======================================================================
app.listen(PORT, () => {
  console.log(`\n🚀 Volten Traffic Triage Server running on http://localhost:${PORT}`);
  console.log("Adaptive Traffic Triage is ENABLED (Warning: 15ms, Critical: 50ms).\n");
  console.log("To test load shedding and VIP route survival, run in another terminal:");
  console.log("  node examples/11-traffic-triage-test.js\n");
});
