import { App } from "../dist/core/server.js";

const volten = new App();
const app = volten.host("**");
const PORT = process.env.PORT || 3000;

// =========================================================================
// 8. STATE MANAGEMENT, COOKIE ABSTRACTIONS & SESSIONS
// =========================================================================
// HTTP is inherently stateless; every request arrives in total isolation.
// To persist a user's identity across pages, servers use cookies to pass
// cryptographic session identifiers back and forth inside header metadata.
//
// 🛡️ SECURITY WARNING: Sensitive context identifiers must always specify the
// HttpOnly and SameSite flags to lock out malicious cross-origin scripts.
// =========================================================================

// Mock Database Session Store (In-memory token table lookup map)
const SESSION_STORE = new Map();

// -------------------------------------------------------------------------
// Example A: Setting a Stateful Session Cookie (Login Simulation)
// -------------------------------------------------------------------------
app.post("/api/v1/auth/login", async (ctx) => {
  // Generate a mock unique session ID token identifier
  const sessionId = "vt_sess_" + Math.random().toString(36).substring(2, 15);

  // Save user metadata details associated with this unique identifier token
  SESSION_STORE.set(sessionId, {
    userId: 42,
    username: "insanerest",
    authenticatedAt: new Date().toISOString(),
  });

  // Write the cookie back onto the response object instance mapping layout.
  // This uses Volten's secure outbound cookie serialization strategy.
  ctx.setCookie("session_id", sessionId, {
    httpOnly: true, // Restricts client-side JavaScript extraction (Stops XSS token leaks)
    secure: false, // Set to TRUE in production environment to force HTTPS execution
    sameSite: "lax", // Mitigation layer against Cross-Site Request Forgery (CSRF)
    maxAge: 60 * 15, // Sets the cookie retention horizon to 15 minutes (in seconds)
    path: "/", // Available across all application routes
  });

  return ctx.json({
    status: "success",
    message:
      "Session token initialized. Cookie emitted safely via Set-Cookie metadata header.",
    sessionPreview: sessionId,
  });
});

// -------------------------------------------------------------------------
// Example B: Inbound Cookie Parsing (Protected Dashboard Access)
// -------------------------------------------------------------------------
app.get("/api/v1/dashboard", (ctx) => {
  // Volten natively parses incoming request header properties via lazy lookup evaluation
  const cookies = ctx.cookies;

  const sessionId = cookies["session_id"];

  // If the browser failed to return our identifier key, reject the client request
  if (!sessionId) {
    return ctx.json(
      {
        status: "error",
        error: "Unauthorized",
        message:
          "Missing session_id token cookie. Please call the login endpoint first.",
      },
      401,
    );
  }

  // Cross-reference token tracking against our high-speed state table lookup store
  const activeSession = SESSION_STORE.get(sessionId);

  if (!activeSession) {
    return ctx.json(
      {
        status: "error",
        error: "InvalidSession",
        message:
          "Target token identifier is expired or removed from memory context tables.",
      },
      403,
    );
  }

  return ctx.json({
    status: "success",
    layer: "inbound-cookie-parser",
    message:
      "Welcome to your protected application metrics view dashboard panel.",
    sessionContext: activeSession,
  });
});

// -------------------------------------------------------------------------
// Example C: Destroying Sessions (Logout Execution)
// -------------------------------------------------------------------------
app.post("/api/v1/auth/logout", (ctx) => {
  const sessionId = ctx.cookies["session_id"];

  if (sessionId) {
    // Purge record from internal database state registers
    SESSION_STORE.delete(sessionId);
  }

  // Instruct browser to instantly drop target values by setting maxAge threshold to 0
  ctx.setCookie("session_id", "", {
    path: "/",
    maxAge: 0, // Expired boundary marker instantly destroys browser store values
  });

  return ctx.json({
    status: "success",
    message:
      "Session deleted from state store registers. Cookie storage reference wiped.",
  });
});

volten.listen(PORT, () => {
  console.log(
    `State Management & Cookie Parsing demo running on http://localhost:${PORT}`,
  );
  console.log(
    `Step 1 [Try Dashboard First - Blocks]: http://localhost:${PORT}/api/v1/dashboard`,
  );
  console.log(
    `Step 2 [Authenticate User - Login]:  POST -> http://localhost:${PORT}/api/v1/auth/login`,
  );
  console.log(
    `Step 3 [Access Dashboard - Success]: http://localhost:${PORT}/api/v1/dashboard`,
  );
  console.log(
    `Step 4 [Clear Authentication - Logout]: POST -> http://localhost:${PORT}/api/v1/auth/logout`,
  );
  console.log("\nQUICK TERMINAL VERIFICATION COMMANDS:");
  console.log(
    `  Login Request:\n  curl -X POST http://localhost:${PORT}/api/v1/auth/login -c cookie_jar.txt\n`,
  );
  console.log(
    `  Dashboard Read (Using Cookie Jar):\n  curl http://localhost:${PORT}/api/v1/dashboard -b cookie_jar.txt\n`,
  );
});
