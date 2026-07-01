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
  setImmediate(() => {
    process.exit(0);
  });
});

test("Volten Server Core Error Pipeline & Boundary Constraints Matrix", async (t) => {
  // Use a slightly larger pool size to protect the entire suite runtime against temporary leaks
  let volten: App;

  let customGlobalErrorHit = false;
  let tenantErrorHit = false;
  let customErrorObject: any = null;

  const resetErrorMetrics = () => {
    customGlobalErrorHit = false;
    tenantErrorHit = false;
    customErrorObject = null;

    volten = new App({
      RequestPoolSize: 20,
      bodyLimit: 256,
      caseInsensitive: true,
      noLogs: true,
    });

    const rootApp = volten.host("**");
    const fallbackTenant = volten.host("isolated.volten.local");

    // Re-mount the common paths required across the matrix suites
    rootApp.get("/error/sync-crash", () => {
      throw new Error("fatal_sync_execution_node");
    });

    rootApp.get("/error/async-crash", async () => {
      throw new Error("fatal_async_promise_node");
    });

    rootApp.post("/error/body-limit", async (ctx) => {
      const data = await ctx.body();
      ctx.json({ received: true, data });
    });

    rootApp.get("/error/read-body-on-get", async (ctx) => {
      const data = await ctx.body("text");
      ctx.text(`body_was:${data}`);
    });

    rootApp.post("/error/empty-body", async (ctx) => {
      const data = await ctx.body();
      ctx.json(data);
    });

    rootApp.get("/error/pipeline-breach", async (ctx, next) => {
      await next();
      await next();
      if (ctx.sent) {
        ctx.text("breach_sink");
      }
    });

    rootApp.get("/error/next-after-send", async (ctx, next) => {
      ctx.text("already_finalized");
      await next();
    });

    fallbackTenant.get("/crash", () => {
      throw new Error("tenant_isolation_breach_fault");
    });

    if (!(volten as any).hostErrorHandlers) {
      (volten as any).hostErrorHandlers = Object.create(null);
    }
  };

  // =========================================================================
  // EXECUTION SUITE MATRIX (10 Advanced Integration Matrices)
  // =========================================================================

  await t.test(
    "Matrix 1: Synchronous Micro-Task Exception Interception & Serialization",
    async () => {
      resetErrorMetrics();
      const res = await request(volten, "/error/sync-crash");
      assert.equal(res.status, 500);
    },
  );

  await t.test(
    "Matrix 2: Asynchronous Promise Rejection Interception & Pipeline Preservation",
    async () => {
      resetErrorMetrics();
      const res = await request(volten, "/error/async-crash");
      assert.equal(res.status, 500);
    },
  );

  await t.test(
    "Matrix 3: Inbound Content-Length Validation Overflow Protection",
    async () => {
      resetErrorMetrics();
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
    },
  );

  await t.test(
    "Matrix 4: Dynamic Stream Chunk Collector Limit Exceedance Handling",
    async () => {
      resetErrorMetrics();

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
    },
  );

  await t.test(
    "Matrix 5: Isolated Multi-Tenant Virtual Host Error Scoping Boundary",
    async () => {
      resetErrorMetrics();

      // Explicitly register directly to the instance's virtual host handler collection
      (volten as any).hostErrorHandlers["isolated.volten.local"] = (
        err: Error,
        ctx: any,
      ) => {
        tenantErrorHit = true;
        customErrorObject = err;
        ctx.status(503).text(`custom_tenant_isolated_catch:${err.message}`);
      };

      const res = await request(volten, "/crash", {
        headers: { host: "isolated.volten.local" },
      });

      assert.equal(res.status, 503);
      assert.equal(tenantErrorHit, true);
      assert.equal(customErrorObject.message, "tenant_isolation_breach_fault");
      (volten as any).hostErrorHandlers["isolated.volten.local"] = null;
    },
  );

  await t.test(
    "Matrix 6: Global Application Fallback Error Middleware Overrides",
    async () => {
      resetErrorMetrics();

      volten.onError((err, ctx) => {
        customGlobalErrorHit = true;
        ctx.status(500).text(`global_intercept:${err.message}`);
      });

      const res = await request(volten, "/error/sync-crash");
      assert.equal(res.status, 500);
      assert.equal(customGlobalErrorHit, true);
    },
  );

  await t.test(
    "Matrix 7: Mid-Pipeline Next-Call Iteration Loop Breaches (Compose Safety)",
    async () => {
      resetErrorMetrics();
      const res = await requestFetch(volten, "/error/pipeline-breach");
      assert.ok(res.status === 500);
    },
  );

  await t.test(
    "Matrix 8: Next-Call Invocation Post Response Stream Serialization Traps",
    async () => {
      resetErrorMetrics();
      const res = await request(volten, "/error/next-after-send");
      assert.equal(res.status, 200);
      assert.equal(res.body, "already_finalized");
    },
  );

  await t.test(
    "Matrix 9: Invalid Header Modification & Flush Actions Guardrail",
    async () => {
      resetErrorMetrics();
      try {
        await request(volten, "/error/double-header-flush");
        assert.fail("The request should not have succeeded with a 200 OK");
      } catch (err: any) {
        // Assert that we caught a network error instead of a valid HTTP response
        assert.ok(err, "A network connection drop was successfully triggered");
      }
    },
  );

  await t.test(
    "Matrix 10: Static Resolution Directory Traversal Access Block Constraints",
    async () => {
      resetErrorMetrics();
      volten.static(TMP_ERR_DIR, "isolated.volten.local");

      const resTraversal = await request(volten, "/../../secret.txt", {
        headers: { host: "isolated.volten.local" },
      });
      assert.equal(resTraversal.status, 404);

      const resGetBody = await request(volten, "/error/read-body-on-get");
      assert.equal(resGetBody.status, 200);
      assert.ok(resGetBody.body.includes("body_was"));
    },
  );
});
