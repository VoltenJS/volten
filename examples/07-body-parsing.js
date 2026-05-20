import { App } from "../dist/core/server.js";

// Global configuration: route options can pass buffer constraints down to the engine
const API_OPTIONS = {
  bodyLimit: 1024 * 1024 * 2, // 2 Megabytes maximum threshold allocation
};

const volten = new App(API_OPTIONS);
const app = volten.host("**");

// =========================================================================
// 7. INBOUND DATA HANDLING & STREAM PAYLOAD THRESHOLD GUARDS
// =========================================================================
// Handling incoming HTTP POST/PUT payloads requires processing data streams.
// Because Node.js receives request bodies in network chunks, Volten collects
// these binary buffers and converts them safely into JavaScript objects.
//
// 🛡️ SECURITY WARNING: Uncapped body parsing leaves a server wide open to
// Denial of Service (DoS) attacks where a malicious client streams a multi-gigabyte
// payload to intentionally exhaust system RAM. Volten stops this using guards.
// =========================================================================

// -------------------------------------------------------------------------
// Example A: Standard JSON Payload Parsing
// -------------------------------------------------------------------------
// This endpoint receives user profile registrations, parses the structural text,
// and enforces framework-level chunk-size safety validation guards.
app.post("/api/v1/users", async (ctx) => {
  try {
    // 1. Await Stream Accumulation
    // Volten reads the raw socket chunks, tracks buffer length against the bodyLimit,
    // and automatically decodes and parses the string buffer into a JSON object.
    const body = await ctx.body();

    // Validate if the request body is empty or malformed
    if (!body || Object.keys(body).length === 0) {
      return ctx.json(
        { status: "error", message: "Request payload cannot be empty." },
        400,
      );
    }

    const { username, email, role } = body;

    // 2. Return Structured Success Message
    ctx.json(
      {
        status: "success",
        layer: "inbound-body-parser",
        message: "User account parsed and verified successfully.",
        processedData: {
          receivedUsername: username,
          receivedEmail: email,
          accountRole: role || "user",
          timestamp: new Date().toISOString(),
        },
      },
      201,
    ); // HTTP 201 Created
  } catch (error) {
    throw error;
  }
});

// -------------------------------------------------------------------------
// Example B: Text/Raw Payload Processing
// -------------------------------------------------------------------------
// Useful for accepting raw string configurations, markdown webhooks, or plain logs.
app.post("/api/v1/logs/raw", async (ctx) => {
  // If no bodyLimit is specified in route options, it falls back to the system default configuration
  const rawText = await ctx.body("text");

  console.log(
    `[Inbound Plaintext Log Blob Received, length: ${rawText.length} chars]`,
  );

  ctx.json({
    status: "success",
    layer: "raw-body-decoding",
    bytesProcessed: rawText.length,
    preview: rawText.slice(0, 100) + (rawText.length > 100 ? "..." : ""),
  });
});

volten.listen(3000, () => {
  console.log(
    "Inbound Data Handling & Body Parsing demo running on http://localhost:3000",
  );
  console.log(
    "Test Endpoint A (JSON): POST -> http://localhost:3000/api/v1/users",
  );
  console.log(
    "Test Endpoint B (TEXT): POST -> http://localhost:3000/api/v1/logs/raw",
  );
  console.log(
    "\nTEST COMMANDS (Run from your terminal to verify payload extraction):",
  );
  console.log(
    `  A [JSON Parsing]:\n  curl -X POST http://localhost:3000/api/v1/users -H "Content-Type: application/json" -d '{"username":"insanerest","email":"insanerest@volten.io","role":"lead"}'\n`,
  );
  console.log(
    `  B [Raw Text Parsing]:\n  curl -X POST http://localhost:3000/api/v1/logs/raw -H "Content-Type: text/plain" -d "SYS_ERR_404: Database connection pool lost stability at internal offset index reference sequence."\n`,
  );
});
