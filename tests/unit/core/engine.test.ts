import { test } from "node:test";
import assert from "node:assert/strict";
import { createExecutionPlan, createSingleHandlerExecutor } from "../../../src/core/engine.ts";
import { compileMiddlewareChain } from "../../../src/core/compose.ts";
import { RequestContext, EdgeRequestContext } from "../../../src/utils/requestCtx.ts";
import { InvalidNextCallError, NotFoundError } from "../../../src/core/errors.ts";
import { App } from "../../../src/core/server.ts";
import type { VoltenHandler } from "../../../src/core/types.ts";

function makeMockCtx(sentStatus = false): RequestContext {
  const ctx = new RequestContext();
  Object.defineProperty(ctx, "sent", {
    get: () => sentStatus,
    configurable: true,
  });
  return ctx;
}

test("Execution Engine Unit Tests", async (t) => {
  await t.test("creates OPTIMIZED plan for single handler route", () => {
    const handler = (ctx: RequestContext) => ctx.send("ok");
    const composeChain = compileMiddlewareChain([handler]);
    const plan = createExecutionPlan("GET", "/test", [handler], composeChain, 0);

    assert.equal(plan.level, "OPTIMIZED");
    assert.equal(plan.effectiveHandlerCount, 1);
    assert.equal(plan.method, "GET");
    assert.equal(plan.path, "/test");
    assert.equal(plan.paramCount, 0);
    assert.equal(typeof plan.executeNode, "function");
    assert.equal(typeof plan.executeEdge, "function");
    assert.equal(plan.fallbackChain, composeChain);
  });

  await t.test("creates GENERIC plan for multiple handler route", () => {
    const m1 = (_ctx: RequestContext, next: () => unknown) => next();
    const handler = (ctx: RequestContext) => ctx.send("ok");
    const composeChain = compileMiddlewareChain([m1, handler]);
    const plan = createExecutionPlan("POST", "/test/:id", [m1, handler], composeChain, 1);

    assert.equal(plan.level, "GENERIC");
    assert.equal(plan.effectiveHandlerCount, 2);
    assert.equal(plan.method, "POST");
    assert.equal(plan.path, "/test/:id");
    assert.equal(plan.paramCount, 1);
    assert.equal(plan.executeNode, composeChain);
    assert.equal(plan.executeEdge, composeChain);
  });

  await t.test("creates GENERIC plan for empty handler chain", () => {
    const composeChain = compileMiddlewareChain([]);
    const plan = createExecutionPlan("GET", "/empty", [], composeChain, 0);

    assert.equal(plan.level, "GENERIC");
    assert.equal(plan.effectiveHandlerCount, 0);
  });

  await t.test("single handler executes synchronously and sends response", async () => {
    let sentData: unknown = null;
    const ctx = makeMockCtx();
    ctx.send = (data: unknown) => {
      sentData = data;
      return ctx;
    };

    const executor = createSingleHandlerExecutor((c) => {
      c.send("hello world");
    });

    await executor(ctx);
    assert.equal(sentData, "hello world");
  });

  await t.test("single handler handles return value via handleHandlerResult", async () => {
    let sentData: unknown = null;
    const ctx = makeMockCtx();
    ctx.send = (data: unknown) => {
      sentData = data;
      return ctx;
    };

    const executor = createSingleHandlerExecutor(() => {
      return { status: "success" };
    });

    await executor(ctx);
    assert.deepEqual(sentData, { status: "success" });
  });

  await t.test("single handler handles async promise return", async () => {
    let sentData: unknown = null;
    const ctx = makeMockCtx();
    ctx.send = (data: unknown) => {
      sentData = data;
      return ctx;
    };

    const executor = createSingleHandlerExecutor(async () => {
      await Promise.resolve();
      return "async result";
    });

    await executor(ctx);
    assert.equal(sentData, "async result");
  });

  await t.test("single handler next() returns Promise.resolve()", async () => {
    let nextRan = false;
    const ctx = makeMockCtx();

    const executor = createSingleHandlerExecutor(async (_c, next) => {
      await next();
      nextRan = true;
    });

    await executor(ctx);
    assert.equal(nextRan, true);
  });

  await t.test("single handler throws InvalidNextCallError on multiple next()", async () => {
    let caughtError: unknown = null;
    const ctx = makeMockCtx();

    const executor = createSingleHandlerExecutor(async (_c, next) => {
      await next();
      try {
        await next();
      } catch (err) {
        caughtError = err;
      }
    });

    await executor(ctx);
    assert.ok(caughtError instanceof InvalidNextCallError);
  });

  await t.test("sync error routes through ctx._app.handleError", async () => {
    let handledError: unknown = null;
    const ctx = makeMockCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any)._app = {
      handleError: (err: unknown) => {
        handledError = err;
      },
    };

    const executor = createSingleHandlerExecutor(() => {
      throw new Error("sync crash");
    });

    await executor(ctx);
    assert.ok(handledError !== null);
    assert.equal((handledError as Error).message, "sync crash");
  });

  await t.test("async rejection routes through ctx._app.handleError", async () => {
    let handledError: unknown = null;
    const ctx = makeMockCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any)._app = {
      handleError: (err: unknown) => {
        handledError = err;
      },
    };

    const executor = createSingleHandlerExecutor(async () => {
      await Promise.resolve();
      throw new Error("async rejection");
    });

    await executor(ctx);
    assert.ok(handledError !== null);
    assert.equal((handledError as Error).message, "async rejection");
  });

  await t.test("app.inspectRoute inspects plan for registered routes", () => {
    const app = new App();
    app.get("/single", (ctx) => ctx.send("single"));
    app.get(
      "/with-middleware",
      (_ctx, next) => next(),
      (ctx) => ctx.send("multi"),
    );

    const singlePlan = app.inspectRoute("GET", "/single");
    assert.ok(singlePlan !== null);
    assert.equal(singlePlan.level, "OPTIMIZED");
    assert.equal(singlePlan.effectiveHandlerCount, 1);

    const multiPlan = app.inspectRoute("GET", "/with-middleware");
    assert.ok(multiPlan !== null);
    assert.equal(multiPlan.level, "GENERIC");
    assert.equal(multiPlan.effectiveHandlerCount, 2);

    const missingPlan = app.inspectRoute("GET", "/non-existent");
    assert.equal(missingPlan, null);
  });
});

interface TestContextState {
  sentData: unknown[];
  statusCodes: number[];
  errorsHandled: unknown[];
  headers: Record<string, string>;
}

function createMockCtx(): { ctx: RequestContext; state: TestContextState } {
  const state: TestContextState = {
    sentData: [],
    statusCodes: [],
    errorsHandled: [],
    headers: {},
  };

  const ctx = new RequestContext();
  let isSent = false;

  Object.defineProperty(ctx, "sent", {
    get: () => isSent,
    set: (val: boolean) => {
      isSent = val;
    },
    configurable: true,
  });

  ctx.send = (data?: unknown) => {
    isSent = true;
    state.sentData.push(data);
    return ctx;
  };

  Object.defineProperty(ctx, "statusCode", {
    get: () => state.statusCodes[state.statusCodes.length - 1] ?? 200,
    set: (code: number) => {
      state.statusCodes.push(code);
    },
    configurable: true,
  });

  ctx.setHeader = (key: string, value: string | number | readonly string[]) => {
    state.headers[key.toLowerCase()] = String(value);
    return ctx;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      state.errorsHandled.push(err);
    },
  };

  return { ctx, state };
}

function createMockEdgeCtx(): {
  ctx: EdgeRequestContext;
  state: TestContextState & { resolvedEdgeResponse: unknown };
} {
  const state: TestContextState & { resolvedEdgeResponse: unknown } = {
    sentData: [],
    statusCodes: [],
    errorsHandled: [],
    headers: {},
    resolvedEdgeResponse: null,
  };

  const ctx = new EdgeRequestContext();
  let isSent = false;

  Object.defineProperty(ctx, "sent", {
    get: () => isSent,
    set: (val: boolean) => {
      isSent = val;
    },
    configurable: true,
  });

  ctx.send = (data?: unknown) => {
    isSent = true;
    state.sentData.push(data);
    return ctx;
  };

  ctx._resolveEdgeResponse = (res: Response) => {
    state.resolvedEdgeResponse = res;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      state.errorsHandled.push(err);
    },
  };

  return { ctx, state };
}

async function assertDifferentialEquivalence(
  name: string,
  handler: VoltenHandler,
  options: { isEdge?: boolean } = {},
) {
  // 1. Run baseline (compileMiddlewareChain)
  const baselineFactory = compileMiddlewareChain([handler]);
  const baselineMock = options.isEdge ? createMockEdgeCtx() : createMockCtx();
  let baselineReturn: unknown;
  let baselineThrown: unknown = null;
  try {
    baselineReturn = await baselineFactory(baselineMock.ctx);
  } catch (err) {
    baselineThrown = err;
  }

  // 2. Run optimized candidate (createSingleHandlerExecutor)
  const candidateFactory = createSingleHandlerExecutor(handler);
  const candidateMock = options.isEdge ? createMockEdgeCtx() : createMockCtx();
  let candidateReturn: unknown;
  let candidateThrown: unknown = null;
  try {
    candidateReturn = await candidateFactory(candidateMock.ctx);
  } catch (err) {
    candidateThrown = err;
  }

  // 3. Differential assertions
  assert.equal(
    candidateThrown,
    baselineThrown,
    `[${name}] Thrown exceptions must match: candidate=${String(candidateThrown)}, baseline=${String(baselineThrown)}`,
  );

  assert.deepEqual(candidateReturn, baselineReturn, `[${name}] Factory return values must match`);

  assert.deepEqual(
    candidateMock.state.sentData,
    baselineMock.state.sentData,
    `[${name}] Sent payloads must match`,
  );

  assert.deepEqual(
    candidateMock.state.statusCodes,
    baselineMock.state.statusCodes,
    `[${name}] Status codes must match`,
  );

  assert.equal(
    candidateMock.ctx.sent,
    baselineMock.ctx.sent,
    `[${name}] Final ctx.sent flag must match`,
  );

  assert.equal(
    candidateMock.state.errorsHandled.length,
    baselineMock.state.errorsHandled.length,
    `[${name}] Error handled counts must match`,
  );

  if (candidateMock.state.errorsHandled.length > 0) {
    const cErr = candidateMock.state.errorsHandled[0] as Error;
    const bErr = baselineMock.state.errorsHandled[0] as Error;
    assert.equal(cErr.message, bErr.message, `[${name}] Handled error messages must match`);
  }

  if (options.isEdge) {
    const cEdge = candidateMock.state as { resolvedEdgeResponse: unknown };
    const bEdge = baselineMock.state as { resolvedEdgeResponse: unknown };
    assert.equal(
      cEdge.resolvedEdgeResponse !== null,
      bEdge.resolvedEdgeResponse !== null,
      `[${name}] Edge response resolution status must match`,
    );
  }
}

test("Differential Semantic Verification: singleHandlerExecutor vs compileMiddlewareChain", async (t) => {
  await t.test("Case 1: Synchronous handler calls ctx.send(string)", async () => {
    await assertDifferentialEquivalence("sync-send", (ctx) => {
      ctx.send("hello world");
    });
  });

  await t.test("Case 2: Synchronous handler returns an object", async () => {
    await assertDifferentialEquivalence("sync-return-obj", () => {
      return { status: 200, message: "ok" };
    });
  });

  await t.test("Case 3: Synchronous handler returns a string", async () => {
    await assertDifferentialEquivalence("sync-return-str", () => {
      return "plain text response";
    });
  });

  await t.test("Case 4: Synchronous handler returns a Buffer", async () => {
    await assertDifferentialEquivalence("sync-return-buf", () => {
      return Buffer.from("buffer data");
    });
  });

  await t.test("Case 5: Synchronous handler returns undefined without sending", async () => {
    await assertDifferentialEquivalence("sync-return-void", () => {
      // no-op
    });
  });

  await t.test("Case 6: Async handler calls ctx.send and resolves", async () => {
    await assertDifferentialEquivalence("async-send", async (ctx) => {
      await Promise.resolve();
      ctx.send("async payload");
    });
  });

  await t.test("Case 7: Async handler returns a value", async () => {
    await assertDifferentialEquivalence("async-return", async () => {
      await Promise.resolve();
      return { asyncResult: true };
    });
  });

  await t.test("Case 8: Async handler returns undefined", async () => {
    await assertDifferentialEquivalence("async-return-void", async () => {
      await Promise.resolve();
    });
  });

  await t.test("Case 9: Synchronous handler throws Error", async () => {
    await assertDifferentialEquivalence("sync-throw-error", () => {
      throw new Error("synchronous database failure");
    });
  });

  await t.test("Case 10: Synchronous handler throws VoltenError subclass", async () => {
    await assertDifferentialEquivalence("sync-throw-volten-error", () => {
      throw new NotFoundError("custom item not found");
    });
  });

  await t.test("Case 11: Synchronous handler throws non-Error primitive", async () => {
    await assertDifferentialEquivalence("sync-throw-string", () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "raw string exception";
    });
  });

  await t.test("Case 12: Async handler rejects with Error", async () => {
    await assertDifferentialEquivalence("async-reject-error", async () => {
      await Promise.resolve();
      throw new Error("async connection timeout");
    });
  });

  await t.test("Case 13: Async handler rejects with VoltenError", async () => {
    await assertDifferentialEquivalence("async-reject-volten-error", async () => {
      await Promise.resolve();
      throw new NotFoundError("async missing entity");
    });
  });

  await t.test("Case 14: Handler calls next() once (returns Promise.resolve())", async () => {
    await assertDifferentialEquivalence("next-once", async (_ctx, next) => {
      const res = await next();
      assert.equal(res, undefined);
    });
  });

  await t.test("Case 15: Handler calls next() twice (throws InvalidNextCallError)", async () => {
    await assertDifferentialEquivalence("next-twice", async (_ctx, next) => {
      await next();
      let caught = false;
      try {
        await next();
      } catch (err) {
        if (err instanceof InvalidNextCallError) caught = true;
      }
      assert.equal(caught, true);
    });
  });

  await t.test("Case 16: Handler calls ctx.send AND returns a value (no double-send)", async () => {
    await assertDifferentialEquivalence("send-and-return", (ctx) => {
      ctx.send("explicit send");
      return "returned value";
    });
  });

  await t.test("Case 17: Edge runtime - returns Web Response directly", async () => {
    await assertDifferentialEquivalence(
      "edge-web-response",
      () => {
        return new Response("edge native response", { status: 201 });
      },
      { isEdge: true },
    );
  });

  await t.test("Case 18: Edge runtime - async returns Web Response", async () => {
    await assertDifferentialEquivalence(
      "edge-async-web-response",
      async () => {
        await Promise.resolve();
        return new Response("edge async response", { status: 202 });
      },
      { isEdge: true },
    );
  });

  await t.test("Case 19: Edge runtime - calls ctx.send()", async () => {
    await assertDifferentialEquivalence(
      "edge-ctx-send",
      (ctx) => {
        ctx.send({ edgeJson: true });
      },
      { isEdge: true },
    );
  });

  await t.test("Case 20: Edge runtime - throws Error", async () => {
    await assertDifferentialEquivalence(
      "edge-sync-throw",
      () => {
        throw new Error("edge crash");
      },
      { isEdge: true },
    );
  });
});
