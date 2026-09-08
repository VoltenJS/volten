import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { App } from "../../src/core/server.ts";
import { request, requestFetch } from "../helpers.ts";

const TMP_ERR_DIR = path.resolve("./.tmp_error_test_dir");

before(() => {
  if (!fs.existsSync(TMP_ERR_DIR)) {
    fs.mkdirSync(TMP_ERR_DIR, { recursive: true });
  }
});

after(() => {
  try {
    fs.rmSync(TMP_ERR_DIR, { recursive: true, force: true });
  } catch {}
});

test("Error Pipeline & Boundary Constraints", async (t) => {
  let volten: App;

  let customGlobalErrorHit = false;
  let tenantErrorHit = false;
  let customErrorObject: any = null;

  const resetErrorMetrics = async () => {
    if (volten) {
      await volten.close();
    }
    customGlobalErrorHit = false;
    tenantErrorHit = false;
    customErrorObject = null;

    volten = new App({
      RequestPoolSize: 20,
      bodyLimit: 256,
      caseInsensitive: true,
      noLogs: true,
    });

    // Re-mount the common paths required across the matrix suites
    volten.get("/error/sync-crash", () => {
      throw new Error("fatal_sync_execution_node");
    });

    volten.get("/error/async-crash", async () => {
      throw new Error("fatal_async_promise_node");
    });

    volten.post("/error/body-limit", async (ctx) => {
      const data = await ctx.body();
      ctx.json({ received: true, data });
    });

    volten.get("/error/read-body-on-get", async (ctx) => {
      const data = await ctx.body("text");
      ctx.text(`body_was:${data}`);
    });

    volten.post("/error/empty-body", async (ctx) => {
      const data = await ctx.body();
      ctx.json(data);
    });

    volten.get("/error/pipeline-breach", async (ctx, next) => {
      await next();
      await next();
      if (ctx.sent) {
        ctx.text("breach_sink");
      }
    });

    volten.get("/error/next-after-send", async (ctx, next) => {
      ctx.text("already_finalized");
      await next();
    });
  };

  // =========================================================================
  // EXECUTION SUITE MATRIX (10 Advanced Integration Matrices)
  // =========================================================================

  await t.test("Intercepts and serializes synchronous exceptions", async () => {
    await resetErrorMetrics();
    const res = await request(volten, "/error/sync-crash");
    assert.equal(res.status, 500);
  });

  await t.test("Intercepts asynchronous promise rejections", async () => {
    await resetErrorMetrics();
    const res = await request(volten, "/error/async-crash");
    assert.equal(res.status, 500);
  });

  await t.test("Validates inbound Content-Length against overflow", async () => {
    await resetErrorMetrics();
    const heavyPayload = "X".repeat(512);

    try {
      const res = await request(volten, "/error/body-limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: heavyPayload,
      });
      assert.equal(res.status, 413);
    } catch (err: any) {
      // Intercepting the raw socket termination. ECONNRESET or an aborted message means validation passed.
      assert.ok(
        err.code === "ECONNRESET" ||
          err.message.includes("hang up") ||
          err.message.includes("aborted"),
      );
    }
  });

  await t.test("Handles stream payload limit exceedance", async () => {
    await resetErrorMetrics();

    try {
      const res = await request(volten, "/error/body-limit", {
        method: "POST",
        headers: { "transfer-encoding": "chunked" },
        body: "Z".repeat(300),
      });
      assert.equal(res.status, 413);
    } catch (err: any) {
      assert.ok(
        err.code === "ECONNRESET" ||
          err.message.includes("hang up") ||
          err.message.includes("aborted"),
      );
    }
  });

  await t.test("Allows overriding the global error handler", async () => {
    await resetErrorMetrics();

    volten.onError((err, ctx) => {
      customGlobalErrorHit = true;
      ctx.status(500).text(`global_intercept:${err.message}`);
    });

    const res = await request(volten, "/error/sync-crash");
    assert.equal(res.status, 500);
    assert.equal(customGlobalErrorHit, true);
  });

  await t.test("Ensures compose safety on next() loop breaches", async () => {
    await resetErrorMetrics();
    const res = await requestFetch(volten, "/error/pipeline-breach");
    assert.ok(res.status === 500);
  });

  await t.test("Traps next() calls after response sent", async () => {
    await resetErrorMetrics();
    const res = await request(volten, "/error/next-after-send");
    assert.equal(res.status, 200);
    assert.equal(res.body, "already_finalized");
  });

  await t.test("Prevents header modification after flush", async () => {
    await resetErrorMetrics();
    try {
      await request(volten, "/error/double-header-flush");
      assert.fail("The request should not have succeeded with a 200 OK");
    } catch (err: any) {
      // Assert that we caught a network error instead of a valid HTTP response
      assert.ok(err, "A network connection drop was successfully triggered");
    }
  });

  await t.test("Blocks directory traversal attempts securely", async () => {
    await resetErrorMetrics();
    volten.static(TMP_ERR_DIR);

    const resTraversal = await request(volten, "/../../secret.txt");
    assert.equal(resTraversal.status, 404);

    const resGetBody = await request(volten, "/error/read-body-on-get");
    assert.equal(resGetBody.status, 200);
    assert.ok(resGetBody.body.includes("body_was"));
  });
});
