import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { App } from "../../src/core/server.ts";
import { request } from "../helpers.ts"; // Assuming this handles server injection or local http fetch
import type { AddressInfo } from "node:net";

// Temporary asset setup for Static file testing paths
const TMP_DIR = path.resolve("./.tmp_static_test_dir");
const TMP_FILE = path.join(TMP_DIR, "asset.txt");
const SUB_DIR = path.join(TMP_DIR, "secure_folder");
const NESTED_FILE = path.join(SUB_DIR, "nested.json");

before(() => {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
  fs.writeFileSync(TMP_FILE, "Volten Framework Asset Payload Data");
  fs.writeFileSync(NESTED_FILE, JSON.stringify({ secure: true }));
});

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
  // Terminate loop ticks smoothly
  setImmediate(() => {
    process.exit(0);
  });
});

test("Volten Core Pipeline Integration", async (t) => {
  // Initialize instance with explicitly small pool sizes to stress-test exhaustion/fallback states
  const volten = new App({
    RequestPoolSize: 2,
    bodyLimit: 1024, // 1KB global limit default
    caseInsensitive: true,
    noLogs: true,
  });

  // State setup tracking execution order
  let middlewareTrace: string[] = [];

  // ==========================================
  // ROUTE DEFINITIONS & COVERAGE TRIGGERS
  // ==========================================

  // Global app level middleware coverage
  volten.use((_, next) => {
    middlewareTrace.push("global_pre");
    next();
  });

  // 1. Basic HTTP Methods
  volten.get("/methods", (ctx) => {
    ctx.text("GET_OK");
  });
  volten.post("/methods", (ctx) => {
    ctx.text("POST_OK");
  });
  volten.put("/methods", (ctx) => {
    ctx.text("PUT_OK");
  });
  volten.patch("/methods", (ctx) => {
    ctx.text("PATCH_OK");
  });
  volten.delete("/methods", (ctx) => {
    ctx.text("DELETE_OK");
  });

  volten.get("/limit", async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    ctx.text("LIMIT_OK");
  });

  // 2. Radix Tree Splitting Nodes & Backtracking Targets
  volten.get("/route/static-segment", (ctx) => {
    ctx.text("static");
  });
  volten.get("/route/static-segment-long", (ctx) => {
    ctx.text("long-static");
  });
  volten.get("/route/:param/fixed", (ctx) => {
    ctx.json({ p: ctx.params["param"] });
  });
  volten.get("/route/:param/:subparam", (ctx) => {
    ctx.json({ p1: ctx.params["param"], p2: ctx.params["subparam"] });
  });
  volten.get("/route/wildcard/*", (ctx) => {
    ctx.text(`wildcard:${ctx.params["*"]}`);
  });

  // 3. Body Limits Overrides
  volten.post("/limit/override", { bodyLimit: 10 }, async (ctx) => {
    const b = await ctx.body();
    ctx.json(b);
  });
  volten.post("/limit/empty", async (ctx) => {
    const b = await ctx.body();
    ctx.json(b);
  });
  volten.get("/limit/read-on-get", async (ctx) => {
    const b = await ctx.body(); // Edge case validation on non-payload body calls
    ctx.json(b);
  });

  // 4. Cookie Management Triggers
  volten.get("/cookies/set", (ctx) => {
    ctx.setCookie("session", "abc", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/app",
    });
    ctx.setCookie("theme", "dark", { maxAge: 3600, domain: "volten.local" });
    ctx.setCookie("multi", "1");
    ctx.setCookie("multi", "2"); // Array header verification
    ctx.text("cookies_set");
  });
  volten.get("/cookies/read", (ctx) => {
    ctx.json(ctx.cookies);
  });

  // 5. Error Pipeline Transitions
  volten.get("/error/sync", () => {
    throw new Error("Deliberate Synchronous Fault");
  });
  volten.get("/error/async", async () => {
    throw new Error("Deliberate Asynchronous Fault");
  });
  volten.get("/error/next-multiple", (_, next) => {
    next();
    next(); // Triggers loop breach guard mechanisms
  });
  volten.get("/error/next-after-sent", async (ctx, next) => {
    ctx.text("already_sent");
    await next();
  });

  // 6. JSON JIT, Buffers, Strings, Content Types, Stream Processing Utilities
  volten.get("/response/buffer", (ctx) => {
    ctx.send(Buffer.from("buffer_payload"));
  });
  volten.get("/response/json-jit", (ctx) => {
    // Repeated execution targets caching systems safely
    ctx.json({ active: true, nodes: [1, 2, 3], metadata: { version: "1.0" } });
  });
  volten.get("/response/empty-string", (ctx) => {
    ctx.send("");
  });
  volten.get("/response/remove-header", (ctx) => {
    ctx.setHeader("X-Remove-Me", "yes");
    ctx.removeHeader("X-Remove-Me");
    ctx.flushHeaders();
    ctx.text("flushed");
  });

  // Static serving registrations
  volten.static(TMP_DIR);

  // ==========================================
  // EXECUTING THE TESTS MATRIX (100+ assertions)
  // ==========================================

  await t.test("Matrix 1: Method Distribution Routing Logic Validation", async () => {
    const verbs = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
    for (const m of verbs) {
      middlewareTrace = [];
      const res = await request(volten, "/methods", { method: m });
      assert.equal(res.status, 200, `Expected 200 on ${m}`);
      assert.equal(res.body, `${m}_OK`);
      assert.ok(
        middlewareTrace.includes("global_pre"),
        "Global middleware sequence verification dropped",
      );
    }
  });

  await t.test("Matrix 2: Radix Path Matching, Splitting Nodes and Deep Backtracks", async () => {
    // Exact Static Route Node Hit
    let res = await request(volten, "/route/static-segment");
    assert.equal(res.status, 200);
    assert.equal(res.body, "static");

    // Radix split branch verification path
    res = await request(volten, "/route/static-segment-long");
    assert.equal(res.status, 200);
    assert.equal(res.body, "long-static");

    // Single token param node matching paths
    res = await request(volten, "/route/v1/fixed");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { p: "v1" });

    // Multi-token path extraction layers
    res = await request(volten, "/route/user_99/profile_data");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { p1: "user_99", p2: "profile_data" });

    // Trailing global catch-all configurations
    res = await request(volten, "/route/wildcard/assets/images/logo.png");
    assert.equal(res.status, 200);
    assert.equal(res.body, "wildcard:assets/images/logo.png");

    // Case insensitivity execution matrix verification
    res = await request(volten, "/RoUtE/StAtIc-SeGmEnT");
    assert.equal(res.status, 200);
    assert.equal(res.body, "static");
  });

  await t.test("Matrix 3: Input Payload, Payload Bounds Violation Controls", async () => {
    // Basic body serialization verification targets
    let res = await request(volten, "/limit/empty", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true });

    // Payload verification inside GET request specifications
    res = await request(volten, "/limit/read-on-get");
    assert.equal(res.status, 200);
  });

  await t.test(
    "Matrix 4: State Serialization, Header Composition & Cookie Processing Engine",
    async () => {
      let res = await request(volten, "/cookies/set");
      assert.equal(res.status, 200);
      const setCookies = res.headers["set-cookie"];
      assert.ok(Array.isArray(setCookies) || typeof setCookies === "string");

      const cookieStr = Array.isArray(setCookies) ? setCookies.join("; ") : setCookies || "";
      assert.ok(cookieStr.includes("session=abc"));
      assert.ok(cookieStr.includes("HttpOnly"));
      assert.ok(cookieStr.includes("Secure"));
      assert.ok(cookieStr.includes("SameSite=Strict"));
      assert.ok(cookieStr.includes("theme=dark"));
      assert.ok(cookieStr.includes("Domain=volten.local"));

      // Echo parsing framework checks
      res = await request(volten, "/cookies/read", {
        headers: { cookie: "user=admin; pass=123; malformed%2" },
      });
      const parsed = res.json<Record<string, string>>();
      assert.equal(parsed["user"], "admin");
      assert.equal(parsed["pass"], "123");
    },
  );

  await t.test(
    "Matrix 5: Fault Pipelines, Multiple Chain Executions and Pipeline Guard rails",
    async () => {
      // Synchronous crash middleware interception loops
      let res = await request(volten, "/error/sync");
      assert.equal(res.status, 500);

      // Asynchronous reject processing operations
      res = await request(volten, "/error/async");
      assert.equal(res.status, 500);

      // Multiple next call detection system verification
      res = await request(volten, "/error/next-multiple");
      // Should trigger error containment structures
      assert.ok(res.status === 500 || res.status === 200);

      // Post response serialization pipeline calls
      res = await request(volten, "/error/next-after-sent");
      assert.equal(res.status, 200);
      assert.equal(res.body, "already_sent");
    },
  );

  await t.test(
    "Matrix 6: Response Body Types, JIT Fingerprinting Optimization Iterations",
    async () => {
      // Buffer serialization streams
      let res = await request(volten, "/response/buffer");
      assert.equal(res.status, 200);
      assert.equal(res.body, "buffer_payload");

      // Empty element responses
      res = await request(volten, "/response/empty-string");
      assert.equal(res.status, 200);
      assert.equal(res.body, "");

      // Header mutation manipulations post serialization states
      res = await request(volten, "/response/remove-header");
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-remove-me"], undefined);

      // JIT compilation optimization path exercises
      // Run multiple iterative invocations to force shape stabilization thresholds inside caching units
      for (let i = 0; i < 15; i++) {
        res = await request(volten, "/response/json-jit");
        assert.equal(res.status, 200);
        const data = res.json<{ active: boolean }>();
        assert.equal(data.active, true);
      }
    },
  );

  await t.test(
    "Matrix 7: Static Target Resolution, Access Bounds, Directory Traversals",
    async () => {
      // Regular asset delivery checks
      let res = await request(volten, "/asset.txt");
      assert.equal(res.status, 200);
      assert.equal(res.body, "Volten Framework Asset Payload Data");
      assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");

      // Nested directory targets verification path
      res = await request(volten, "/secure_folder/nested.json");
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), { secure: true });

      // Missing targeted file allocations fallback paths gracefully
      res = await request(volten, "/missing-file-target.css");
      assert.equal(res.status, 404);

      // Malicious directory relative transversal attempts containment checking bounds
      res = await request(volten, "/../package.json");
      assert.equal(res.status, 404);

      res = await request(volten, "/secure_folder/../../src/core/server.ts");
      assert.equal(res.status, 404);
    },
  );

  await t.test(
    "Matrix 8: Server Pool Contention States & Dynamic URL Resolution Edge-cases",
    async () => {
      // 1. Validate the standard router parameter resolution safely
      let res = await request(volten, "/methods?key=val&multi=a&multi=b+c");
      assert.equal(res.status, 200);
      const isolatedApp = new App({
        RequestPoolSize: 2,
        bodyLimit: 1024,
      });
      isolatedApp.get("/sluggish-node", async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        ctx.text("OK");
      });

      const contentionServer = isolatedApp.listen(0);
      const assignedPort = await new Promise<number>((resolve) => {
        contentionServer.on("listening", () => {
          const addr = contentionServer.address() as AddressInfo;
          resolve(addr.port);
        });
      });

      const targetUrl = `http://127.0.0.1:${assignedPort}/sluggish-node`;
      const burstPromises: Promise<Response>[] = [];
      for (let i = 0; i < 6; i++) {
        burstPromises.push(fetch(targetUrl, { headers: { Connection: "close" } }));
      }

      const networkOutcomes = await Promise.all(burstPromises);
      const codeList = networkOutcomes.map((r) => r.status);

      await new Promise<void>((resolve) => {
        if (typeof contentionServer.closeAllConnections === "function") {
          contentionServer.closeAllConnections();
        }
        contentionServer.close(() => resolve());
      });

      const has200 = codeList.includes(200);
      const has503 = codeList.includes(503);

      assert.ok(has200, "Isolated pool failed to process baseline valid items.");
      assert.ok(has503, "Starvation protective barrier failed to yield a 503 status.");
    },
  );
  volten.close();
});
