import { App } from "../dist/core/server.js";

const volten = new App();
const app = volten.host("**");
const PORT = process.env.PORT || 3000;
// =========================================================================
// 3. ADVANCED JSON SERIALIZATION & RESOURCE BENCHMARKING
// =========================================================================
// This example demonstrates how Volten handles heavy data serialization,
// dynamic route parameters, and custom response headers under immense load.
//
// ⚠️ BENCHMARK NOTE: Running this endpoint with high concurrency (-c 1000)
// will stress-test your system's memory and V8's synchronous stringify limits.
// =========================================================================

app.get("/api/v1/internal/users/:id/statistics/detailed", (ctx) => {
  // 1. Explicit Header Modification
  // Setting security headers directly on the context before rendering the response.
  ctx.setHeader("X-Content-Type-Options", "nosniff");
  ctx.setHeader("X-Frame-Options", "DENY");
  ctx.setHeader("X-XSS-Protection", "1; mode=block");
  ctx.setHeader("X-Volten-Engine", "v1.0.0");

  // 2. Dynamic Parameter Extraction
  // The routing engine automatically parses named parameters from the URL matching path.
  const userId = ctx.params.id;

  // 3. Extracting Request Headers
  // Volten surfaces incoming headers for authentication checks (e.g., API keys).
  const clientApiKey = ctx.headers["x-api-key"] || "none";

  // 4. Large Dataset Allocation (Mocking ~10 Megabytes of nested objects)
  // Generating a deep data structure to observe Garbage Collection and memory pressure.
  const heavyReport = {
    header: {
      uuid: `v1-${userId}`,
      timestamp: new Date().toISOString(),
    },
    // Creates 5,000 unique records, each containing a 100-item nested array
    metrics: Array.from({ length: 5000 }, (_, i) => ({
      key: `metric_${i}`,
      value: Math.random() * 100,
      contributorIds: Array.from({ length: 100 }, (_, j) => `user_${j}`),
    })),
    security: { apiKey: clientApiKey },
    // Generates an additional 5,000 sub-objects to simulate high object density
    subReports: Array.from({ length: 5000 }, (_, i) => ({
      id: `sub-${i}`,
      details: "Optimized for performance",
      contributorIds: Array.from({ length: 100 }, (_, j) => `user_${j}`),
    })),
  };

  // 5. High-Performance Output Delivery
  // ctx.json handles content-type configuration, content-length calculation,
  // and hands the stringified buffer directly off to the native HTTP socket.
  return ctx.json(heavyReport);
});

volten.listen(PORT, () => {
  console.log("Heavy JSON Response demo running on http://localhost:" + PORT);
  console.log(
    `Test URL: http://localhost:${PORT}/api/v1/internal/users/99/statistics/detailed`,
  );
});
