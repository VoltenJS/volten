import { App } from "../dist/core/server.js";

const volten = new App();
const app = volten.host("**");

// =========================================================================
// 9. HIGH-PERFORMANCE BUFFERED STREAMING & BACKPRESSURE RESILIENCE
// =========================================================================
// Standard HTTP servers choke when serializing huge string payloads at once.
// Volten optimizes this via an internal memory allocation ring buffer.
//
// Using `ctx.writeStatic()` packs data into a fixed binary heap segment,
// flushing down to the network kernel only when full. This lowers syscall
// overhead dramatically while avoiding massive single-string V8 memory spans.
// =========================================================================

// -------------------------------------------------------------------------
// Example A: High-Speed Buffered Dataset Streaming
// -------------------------------------------------------------------------
app.get("/api/v1/stream/dataset", async (ctx) => {
  ctx.setHeader("Content-Type", "application/json; charset=utf-8");
  ctx.setHeader("Transfer-Encoding", "chunked");
  ctx.res.statusCode = 200;

  const maxItems = 5000;

  await ctx.writeStatic("[");

  for (let i = 1; i <= maxItems; i++) {
    const record = {
      id: i,
      uuid: crypto.randomUUID(),
      metric: Math.floor(Math.random() * 10000),
      status: "buffered_stream",
    };

    const isLast = i === maxItems;
    const rowString = JSON.stringify(record) + (isLast ? "" : ",");

    await ctx.writeStatic(rowString);
  }

  await ctx.writeStatic("]");
  await ctx.flush();
  ctx.res.end();
});

// -------------------------------------------------------------------------
// Example B: Real-Time Buffered Server-Sent Events (SSE)
// -------------------------------------------------------------------------
app.get("/api/v1/stream/events", async (ctx) => {
  ctx.setHeader("Content-Type", "text/event-stream");
  ctx.setHeader("Cache-Control", "no-cache");
  ctx.setHeader("Connection", "keep-alive");
  ctx.res.statusCode = 200;

  console.log("📡 [Buffered SSE Client Connection Opened]");

  let heartbeatCount = 0;
  let activeTimeoutId = null;

  async function sendPulse() {
    // Clear out trailing task traces explicitly
    activeTimeoutId = null;
    heartbeatCount++;

    // If we have exceeded our maximum threshold boundary count, stream the closing metrics sequence
    if (heartbeatCount > 5) {
      await ctx.writeStatic("event: end\ndata: Stream complete\n\n");
      await ctx.flush();
      if (ctx.res && !ctx.res.writableEnded) {
        ctx.res.end();
      }
      console.log("🏁 [Buffered SSE Stream Finished]");
      return;
    }

    const eventData = `event: server-update\ndata: ${JSON.stringify({ pulse: heartbeatCount, load: Math.random() })}\n\n`;

    await ctx.writeStatic(eventData);
    await ctx.flush();

    // Schedule the next macro-task iteration frame *only* if the stream remains active and uncompleted
    if (heartbeatCount < 5) {
      activeTimeoutId = setTimeout(sendPulse, 2000);
    } else {
      // Immediate clean shortcut execution trace jump for the terminal execution frame block
      activeTimeoutId = setTimeout(sendPulse, 0);
    }
  }

  // Initial trigger start
  sendPulse();

  ctx.req.on("close", () => {
    if (activeTimeoutId) {
      clearTimeout(activeTimeoutId);
      activeTimeoutId = null;
    }
    console.log("🔌 [Client disconnected connection tracker cleaned up]");
  });
});

volten.listen(3000, () => {
  console.log(
    "High-Performance Buffered Streams demo running on http://localhost:3000",
  );
  console.log(
    "Test Endpoint A (Buffered Data Array): http://localhost:3000/api/v1/stream/dataset",
  );
  console.log(
    "Test Endpoint B (Buffered Live SSE):   http://localhost:3000/api/v1/stream/events",
  );
  console.log("\nTEST COMMANDS:");
  console.log(`  curl http://localhost:3000/api/v1/stream/dataset\n`);
  console.log(`  curl http://localhost:3000/api/v1/stream/events -N\n`);
});
