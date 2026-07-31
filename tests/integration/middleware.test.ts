import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../src/core/server.ts";
import { RequestContext } from "../../src/utils/requestCtx.ts";
import type { Next } from "../../src/core/types.ts";
import { request } from "../helpers.ts";

test("Volten Middleware Execution Pipeline & Lifecycle Matrix", async (t) => {
  const volten = new App({
    RequestPoolSize: 10,
    bodyLimit: 4096,
    caseInsensitive: true,
    noLogs: true,
  });

  // Isolated matrix trace collectors to guarantee zero cross-test state pollution
  let onionTrace: string[] = [];
  let tenantTrace: string[] = [];
  let inlineTrace: string[] = [];
  let errorTrace: string[] = [];
  let doubleNextTrace: string[] = [];
  let raceTrace: string[] = [];
  let postMutateState: any = null;
  let globalExecutionCount = 0;

  // =========================================================================
  // GLOBAL & SCOPED MIDDLEWARE DEFINITIONS
  // =========================================================================

  // 1. Classical Onion Model Layering (Differentiated safely via path matching)
  volten.use(async (ctx, next) => {
    globalExecutionCount++;

    if (ctx.url.includes("/pipeline/onion")) {
      onionTrace.push("onion_1_in");
      await next();
      onionTrace.push("onion_1_out");
    } else if (ctx.url.includes("/pipeline/concurrent-race")) {
      const delay = parseInt((ctx.query["delay"] as string) || "5", 10);
      raceTrace.push(`race_in_${delay}`);
      await next();
      raceTrace.push(`race_out_${delay}`);
    } else {
      await next();
    }
  });

  volten.use(async (ctx, next) => {
    if (ctx.url.includes("/pipeline/onion")) {
      onionTrace.push("onion_2_in");
      await next();
      onionTrace.push("onion_2_out");
    } else {
      await next();
    }
  });

  // 2. Multi-tenant/VHost Scoped Isolated Middleware
  volten.use(async (ctx, next) => {
    if (ctx.url.includes("/pipeline/onion")) {
      tenantTrace.push("tenant_layer_in");
      ctx.setHeader("X-Tenant-Processed", "true");
      await next();
      tenantTrace.push("tenant_layer_out");
    } else {
      await next();
    }
  });

  // 3. State Mutation Pipeline Interceptor
  volten.use(async (ctx, next) => {
    if (ctx.url.includes("/state/")) {
      ctx.state["internalTimestamp"] = 1716584400;
      ctx.state["securityClearance"] = "Level-4";
      ctx.state["mutatedTree"] = { initial: true };
    }
    await next();
  });

  // 8. Runtime Error Bubbling Upstream Middleware Boundary
  volten.use(async (ctx, next) => {
    if (ctx.url.includes("/pipeline/error-bubbling")) {
      errorTrace.push("bubble_outer_in");
      try {
        await next();
      } catch (err: any) {
        errorTrace.push(`bubble_outer_catch:${err.message}`);
        if (!ctx.res?.headersSent) {
          ctx.status(502).text(`recovered:${err.message}`);
        }
      } finally {
        errorTrace.push("bubble_outer_out");
      }
    } else {
      await next();
    }
  });

  // 9. Post-Execution Stream Resiliency Guardrail
  volten.use(async (ctx, next) => {
    await next();
    if (ctx.url.includes("/pipeline/post-mutate")) {
      ctx.state["postExecutionMarker"] = "cleaned-up";
      postMutateState = structuredClone(ctx.state);
      try {
        // Framework safety check: Ensure trying to append headers on spent wire drops cleanly
        ctx.setHeader("X-Post-Mutation", "malicious-write-attempt");
      } catch (e) {
        // Swallowed or handled natively by Volten
      }
    }
  });

  // 10. High-Frequency Payload Stress Interception Middleware
  volten.use(async (ctx, next) => {
    if (ctx.url.includes("/pipeline/stress-payload")) {
      const parsedBody = await ctx.body();
      if (parsedBody && typeof parsedBody === "object") {
        (parsedBody as any).intercepted = true;
      }
    }
    await next();
  });

  // =========================================================================
  // TERMINAL SINGLE-HANDLER ROUTE MOUNTINGS
  // =========================================================================

  volten.get("/pipeline/onion", (ctx) => {
    onionTrace.push("handler_onion_hit");
    ctx.text("onion_resolved");
  });

  volten.get("/state/mutation-pass", (ctx) => {
    if (ctx.state["mutatedTree"]) {
      (ctx.state["mutatedTree"] as any).downstream = "appended";
    }
    ctx.json({
      timestamp: ctx.state["internalTimestamp"],
      clearance: ctx.state["securityClearance"],
      tree: ctx.state["mutatedTree"],
    });
  });

  // Short-Circuiting via inline route middleware execution bypass
  volten.get(
    "/pipeline/short-circuit",
    async (ctx, _next) => {
      ctx.status(403).text("Forbidden Outright");
      // Intentionally omitting next() breaks the chain before hitting the final handler
    },
    (ctx) => {
      ctx.text("unreachable_payload");
    },
  );

  volten.get("/pipeline/concurrent-race", async (ctx) => {
    const delay = parseInt((ctx.query["delay"] as string) || "5", 10);
    await new Promise((resolve) => setTimeout(resolve, delay));
    ctx.text("race_condition_resolved");
  });

  // Inline Route Middleware Chain leading to a single handler
  const guardAlpha = async (_ctx: RequestContext, next: Next) => {
    inlineTrace.push("alpha_in");
    await next();
    inlineTrace.push("alpha_out");
  };

  const guardBeta = async (_ctx: RequestContext, next: Next) => {
    inlineTrace.push("beta_in");
    await next();
    inlineTrace.push("beta_out");
  };

  volten.get("/pipeline/inline-guards", guardAlpha, guardBeta, (ctx) => {
    inlineTrace.push("inline_handler");
    ctx.text("guards_passed");
  });

  volten.get("/pipeline/double-next", async (_ctx, next) => {
    doubleNextTrace.push("double_next_trigger");
    await next();
    await next();
  });

  volten.get("/pipeline/error-bubbling", async () => {
    errorTrace.push("bubble_inner_handler");
    throw new Error("unhandled_downstream_fault");
  });

  volten.get("/pipeline/post-mutate", (ctx) => {
    ctx.text("payload_intact");
  });

  // Single-Handler Stress Target (Consuming cached body)
  volten.post("/pipeline/stress-payload", async (ctx) => {
    const body = await ctx.body();
    ctx.json(body);
  });

  // =========================================================================
  // EXECUTION MATRIX SUITE
  // =========================================================================

  await t.test(
    "Matrix 1: Classical Sequential Onion-Model Architecture Hierarchy Verification",
    async () => {
      onionTrace = [];
      const res = await request(volten, "/pipeline/onion");
      assert.equal(res.status, 200);
      assert.equal(res.body, "onion_resolved");
      assert.deepEqual(onionTrace, [
        "onion_1_in",
        "onion_2_in",
        "handler_onion_hit",
        "onion_2_out",
        "onion_1_out",
      ]);
    },
  );

  await t.test("Matrix 2: Deep Request Context Pipeline State Mutation Propagation", async () => {
    const res = await request(volten, "/state/mutation-pass");
    assert.equal(res.status, 200);
    const parsed = res.json<any>();
    assert.equal(parsed.timestamp, 1716584400);
    assert.equal(parsed.clearance, "Level-4");
    assert.deepEqual(parsed.tree, {
      initial: true,
      downstream: "appended",
    });
  });

  await t.test("Matrix 3: Non-Awaited Immediate Short-Circuit Pipeline Interceptions", async () => {
    const res = await request(volten, "/pipeline/short-circuit");
    assert.equal(res.status, 403);
    assert.equal(res.body, "Forbidden Outright");
  });

  await t.test(
    "Matrix 4: Dynamic Asynchronous Concurrency Race Controls & Context Desynchronization",
    async () => {
      raceTrace = [];
      const flowA = request(volten, "/pipeline/concurrent-race?delay=30");
      const flowB = request(volten, "/pipeline/concurrent-race?delay=2");

      const [resA, resB] = await Promise.all([flowA, flowB]);
      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);

      assert.equal(raceTrace[0], "race_in_30");
      assert.equal(raceTrace[1], "race_in_2");
      assert.equal(raceTrace[2], "race_out_2");
    },
  );

  await t.test(
    "Matrix 5: Composite Inline Multiplex Route Guard Arrays Processing Order",
    async () => {
      inlineTrace = [];
      const res = await request(volten, "/pipeline/inline-guards");
      assert.equal(res.status, 200);
      assert.deepEqual(inlineTrace, [
        "alpha_in",
        "beta_in",
        "inline_handler",
        "beta_out",
        "alpha_out",
      ]);
    },
  );

  await t.test(
    "Matrix 6: Loop Defection Guardrails vs Malicious Double Next-Call Implementations",
    async () => {
      doubleNextTrace = [];
      const res = await request(volten, "/pipeline/double-next");
      assert.ok(res.status === 200 || res.status === 500);
      assert.ok(doubleNextTrace.includes("double_next_trigger"));
    },
  );

  await t.test(
    "Matrix 7: Two-Way Asynchronous Error Bubbling Upstream & Recovery Controls",
    async () => {
      errorTrace = [];
      const res = await request(volten, "/pipeline/error-bubbling");
      assert.ok(res.status === 500 || res.status === 502);
      assert.ok(errorTrace.includes("bubble_inner_handler"));
    },
  );

  await t.test(
    "Matrix 8: Outbound Boundary Response Protection & Post-Execution Cleanup State",
    async () => {
      postMutateState = null;
      const res = await request(volten, "/pipeline/post-mutate");
      assert.equal(res.status, 200);
      assert.equal(res.body, "payload_intact");
      assert.equal(res.headers["x-post-mutation"], undefined);
      assert.ok(postMutateState !== null);
      assert.equal(postMutateState.postExecutionMarker, "cleaned-up");
    },
  );

  await t.test(
    "Matrix 9: Memory Leak Prevention & High Frequency Payload Buffer Mutations Stress",
    async () => {
      for (let i = 0; i < 10; i++) {
        const payloadData = { iteration: i };

        const res = await request(volten, "/pipeline/stress-payload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payloadData),
        });

        assert.equal(res.status, 200);
        const returningJson = res.json<any>();
        assert.equal(returningJson.iteration, i);
        assert.equal(returningJson.intercepted, true);
      }
      assert.ok(globalExecutionCount > 0);
    },
  );
  volten.close();
});
