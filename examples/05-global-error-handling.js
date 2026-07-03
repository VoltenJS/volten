import { App } from "../dist/core/server.js";

const app = new App();
const PORT = process.env.PORT || 3000;
// =========================================================================
// 5. GLOBAL ERROR HANDLING & PROCESS RESILIENCE
// =========================================================================
// In high-performance, single-threaded runtimes like Node.js, an unhandled
// exception inside a route can crash the entire server process.
//
// This example showcases how Volten's built-in global error handling mechanism (onError) can be used
// to easily add a custom global error handler, while defaulting to a regular 500 response if no custom handler is provided.
// =========================================================================

// 🛡️ Global Error Boundary with built in (onError)

app.onError((error, ctx) => {
  // 1. Log the error details for debugging and monitoring purposes
  console.error(
    `🚨 [Volten Engine Core Exception Intercepted]:`,
    error.message,
  );

  // 2. Respond to the client with a clean HTTP 500 status code
  // instead of letting the connection hang or tearing down the server process.
  ctx.setHeader("X-Volten-Error", "true");

  ctx.json(
    {
      status: "error",
      error: {
        type: "InternalServerError",
        message: "An unexpected runtime error occurred on the server.",
        details: error.message, // Typically hidden or sanitized in production environments
      },
    },
    500,
  ); // Emitting an explicit HTTP 500 Internal Server Error status
});

// -------------------------------------------------------------------------
// Route A: The Functional Route
// -------------------------------------------------------------------------
app.get("/api/v1/healthy", (ctx) => {
  return ctx.json({ status: "healthy", message: "System operational." });
});

// -------------------------------------------------------------------------
// Route B: The Exploded Route (Simulated Unhandled Runtime Bug)
// -------------------------------------------------------------------------
app.get("/api/v1/explode", (ctx) => {
  // Simulating a critical developer mistake (calling a method on an undefined object)
  const databaseConnection = undefined;

  // This statement will throw a native: "TypeError: Cannot read properties of undefined (reading 'query')"
  databaseConnection.query("SELECT * FROM users");
});

app.listen(PORT, () => {
  console.log(
    "Resilient Error Handling demo running on http://localhost:" + PORT,
  );
  console.log(
    `Test Healthy Route (Baseline): http://localhost:${PORT}/api/v1/healthy`,
  );
  console.log(
    `Test Exploded Route (Protection): http://localhost:${PORT}/api/v1/explode`,
  );
});
