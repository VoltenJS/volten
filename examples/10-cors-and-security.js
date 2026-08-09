import { App } from "../dist/index.js";

const app = new App();
const PORT = process.env.PORT || 3000;

// =========================================================================
// 10. MULTI-ORIGIN CONFIGURATION & SECURITY HEADERS
// =========================================================================
// When a frontend application (e.g., React/Vue running on localhost:5173)
// requests data from a separate backend API domain (localhost:3000), web browsers
// block the request unless the server explicitly permits it via CORS headers.
//
// Additionally, production-grade servers must emit explicit security headers
// to defend against Clickjacking, Cross-Site Scripting (XSS), and MIME sniffing.
// =========================================================================

// 🛡️ Reusable Security & CORS Middleware Configuration using built-in "preflight" function
app.preflight((ctx) => {
  const origin = ctx.headers["origin"] || "*";

  // 1. Core CORS Header Configurations
  ctx.setHeader("Access-Control-Allow-Origin", origin);
  ctx.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  ctx.setHeader("Access-Control-Allow-Credentials", "true");
  ctx.setHeader("Access-Control-Max-Age", "86400"); // Cache preflight results for 24 hours (in seconds)

  // 2. HTTP OPTIONS Preflight Handshake Interception
  // Browsers automatically send an OPTIONS request before executing unsafe methods (POST, PUT, DELETE).
  // If caught, the server must respond with a clean HTTP 204 No Content status instantly.
  if (ctx.method === "OPTIONS") {
    ctx.statusCode = 204;
    return ctx.res.end(); // Early exit: block downstream route handlers from executing unnecessarily
  }

  // 3. Essential Production Security Headers (OWASP Top 10 Protections)
  ctx.setHeader("X-Content-Type-Options", "nosniff"); // Mitigates drive-by download MIME sniffing exploits
  ctx.setHeader("X-Frame-Options", "DENY"); // Completely blocks Clickjacking frame injection attacks
  ctx.setHeader("X-XSS-Protection", "1; mode=block"); // Instructs older browsers to halt execution if XSS is detected
  ctx.setHeader("Referrer-Policy", "no-referrer-when-downgrade"); // Protects secure tracking analytics states
  ctx.setHeader("Content-Security-Policy", "default-src 'self';"); // Restricts asset delivery to verified domains only
});

// -------------------------------------------------------------------------
// Secure Route Example
// -------------------------------------------------------------------------
app.get("/api/v1/secure-data", (ctx) => {
  return ctx.json({
    status: "success",
    layer: "security-and-cors-guard",
    message: "This payload is shielded by explicit multi-origin and security access constraints.",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(
    "Multi-Origin Configuration & Security Guard demo running on http://localhost:" + PORT,
  );
  console.log(`Secure API Access Endpoint: http://localhost:${PORT}/api/v1/secure-data`);
  console.log(
    `\nTEST COMMANDS (Run from your terminal to verify cross-origin validation handshakes):`,
  );
  console.log(
    `  1. Simulate standard browser CORS preflight check (OPTIONS request):\n` +
      `  curl -X OPTIONS http://localhost:${PORT}/api/v1/secure-data -i -H "Origin: http://localhost:${PORT + 3}" -H "Access-Control-Request-Method: GET"\n`,
  );
  console.log(
    `  2. Read data payload with complete security and safety headers attached:\n` +
      `  curl http://localhost:${PORT}/api/v1/secure-data -i -H "Origin: http://localhost:${PORT + 3}"\n`,
  );
});
