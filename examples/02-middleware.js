import { App } from "../dist/core/server.js";
const volten = new App();
const app = volten.host("**");
const PORT = process.env.PORT || 3000;
// =========================================================================
// 1. GLOBAL MIDDLEWARE (The Onion Model)
// =========================================================================
// Middleware in Volten executes from top to bottom, pausing at 'next()',
// and then winds back up from bottom to top.
app.use((ctx, next) => {
  // Comment out the next 2 lines if benchmarking, as logging adds masive overhead
  const start = Date.now();
  console.log(`--> [Incoming] ${ctx.method} ${ctx.url}`);

  // 2. State Sharing: Mutate ctx.state to pass data down the chain
  ctx.state.user = { id: "user_99", role: "admin" };

  // Wait for downstream middlewares and the route handler to finish
  next();

  // Code below next() runs on the way back OUT of the server

  // Comment out the next 2 lines if benchmarking, as logging adds masive overhead
  const duration = Date.now() - start;
  console.log(`<-- [Outgoing] Handled in ${duration}ms`);
});

// =========================================================================
// 2. ROUTE-SPECIFIC MIDDLEWARE (Guard/Auth example)
// =========================================================================
const isAdmin = (ctx, next) => {
  if (ctx.state.user?.role !== "admin") {
    // Short-circuiting: by not calling next(), we stop the request chain
    ctx.text("Unauthorized", 403);
  }
  next();
};

// =========================================================================
// 3. ROUTES
// =========================================================================

// Public route - only triggers the global logger middleware
app.get("/", (ctx) => {
  return ctx.text("Welcome to the public homepage!");
});

// Protected route - passes through global logger, then isAdmin guard
app.get("/dashboard", isAdmin, (ctx) => {
  // Accessing data injected by the global middleware
  const user = ctx.state.user;
  return ctx.json({
    message: `Welcome to the dashboard, ${user.id}!`,
    role: user.role,
  });
});

volten.listen(process.env.PORT || 3000, () => {
  console.log("Middleware demo running on http://localhost:" + PORT);
});
