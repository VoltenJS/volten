import { App } from "../dist/core/server.js";

const volten = new App();
// Using "**" as the host matcher allows the application to respond to any incoming hostname
const app = volten.host("**");
const PORT = process.env.PORT || 3000;
// =========================================================================
// 4. ROUTING SYSTEM, DYNAMIC PARAMETERS, AND WILDCARDS
// =========================================================================
// This example highlights Volten's structural URL processing capabilities.
// A robust routing layer must parse string segments quickly without allocating
// heavy temporary arrays, preserving the framework's low-latency baseline.
// =========================================================================

// -------------------------------------------------------------------------
// Example A: Standard Dynamic Named Parameters
// -------------------------------------------------------------------------
// Colon syntax (:paramName) tells Volten to capture that specific URL segment
// and map it directly into the `ctx.params` object.
app.get("/shop/:category/:productId", (ctx) => {
  // Extracting parameters extracted by Volten's pattern matcher
  const category = ctx.params.category;
  const productId = ctx.params.productId;

  return ctx.json({
    status: "success",
    layer: "dynamic-router",
    data: {
      requestedCategory: category,
      requestedProduct: productId,
    },
  });
});

// -------------------------------------------------------------------------
// Example B: Wildcard / Catch-All Routes
// -------------------------------------------------------------------------
// The asterisk (*) functions as a wildcard. It matches any sequence of nested
// paths from that point forward. This is essential for serving static files,
// building reverse proxies, or creating catch-all routing fallback rules.
app.get("/static/*", (ctx) => {
  // The captured trailing path is stored under ctx.params['*']
  const assetPath = ctx.params["*"];

  return ctx.json({
    status: "success",
    layer: "wildcard-fallback",
    message: "Static asset router triggered",
    resolvedPath: `/public/assets/${assetPath}`,
  });
});

// -------------------------------------------------------------------------
// Example C: Query Parameter Handling
// -------------------------------------------------------------------------
// Modern applications rely heavily on search queries (e.g., ?search=node&limit=10).
// Volten extracts these key-value pairs and surfaces them cleanly on the context.
app.get("/api/v1/search", (ctx) => {
  // Accessing the parsed query string parameters directly from the context
  const searchTerm = ctx.query?.q || "all";
  const limit = ctx.query?.limit || "10";
  const page = ctx.query?.page || "1";

  return ctx.json({
    status: "success",
    layer: "query-parser",
    pagination: {
      current_page: parseInt(page, 10),
      limit_per_page: parseInt(limit, 10),
    },
    results: {
      query_executed: searchTerm,
      mock_dataset_size: 42,
    },
  });
});

volten.listen(PORT, () => {
  console.log("Routing & Wildcards demo running on http://localhost:" + PORT);
  console.log(
    `Test Parameter Routing: http://localhost:${PORT}/shop/electronics/mac-studio`,
  );
  console.log(
    `Test Wildcard Routing:  http://localhost:${PORT}/static/images/logos/voltenLogo.png`,
  );
  console.log(
    `Test Query Parsing:     http://localhost:${PORT}/api/v1/search?q=high-performance&limit=25`,
  );
});
