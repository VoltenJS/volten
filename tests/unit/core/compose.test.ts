import { test, after } from "node:test";
import assert from "node:assert/strict";
import { compileMiddlewareChain } from "../../../src/core/compose.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

after(() => {
  setImmediate(() => {
    process.exit(0);
  });
});

function makeCtx(sentStatus = false): RequestContext {
  const ctx = new RequestContext();
  Object.defineProperty(ctx, "sent", {
    get: () => sentStatus,
    configurable: true,
  });
  return ctx;
}

test("compose: empty chain resolves instantly", async () => {
  const chain = compileMiddlewareChain([]);
  await chain(makeCtx());
  assert.ok(true, "Empty chain resolved successfully");
});

test("compose: middleware and final handler run in sequential order", async () => {
  const trace: string[] = [];

  const chain = compileMiddlewareChain([
    async (ctx, next) => {
      trace.push("m1:before");
      await next();
      trace.push("m1:after");
    },
    async (ctx, next) => {
      trace.push("m2:before");
      await next();
      trace.push("m2:after");
    },
    (ctx) => {
      trace.push("final");
    },
  ]);

  await chain(makeCtx());

  assert.deepEqual(trace, [
    "m1:before",
    "m2:before",
    "final",
    "m2:after",
    "m1:after",
  ]);
});

test("compose: middleware can short-circuit by not calling next", async () => {
  const trace: string[] = [];

  const chain = compileMiddlewareChain([
    (ctx, next) => {
      trace.push("m1");
      // intentionally short-circuits here
    },
    (ctx, next) => {
      trace.push("m2");
      next();
    },
    (ctx) => {
      trace.push("final");
    },
  ]);

  await chain(makeCtx());

  // m2 and final must remain uncalled
  assert.deepEqual(trace, ["m1"]);
});

test("compose: synchronous next() works cleanly for sync middleware blocks", async () => {
  let finalCalled = false;

  const chain = compileMiddlewareChain([
    (ctx, next) => {
      next();
    },
    () => {
      finalCalled = true;
    },
  ]);

  await chain(makeCtx());
  assert.equal(finalCalled, true);
});

test("compose: a thrown error inside a handler is routed through ctx._app.handleError", async () => {
  let caught: unknown = null;
  const ctx = makeCtx();
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      caught = err;
    },
  };

  const chain = compileMiddlewareChain([
    () => {
      throw new Error("boom from handler");
    },
  ]);

  await chain(ctx);
  assert.ok(caught instanceof Error);
  assert.equal((caught as Error).message, "boom from handler");
});

test("compose: an async rejection inside a handler is routed through ctx._app.handleError", async () => {
  let caught: unknown = null;
  const ctx = makeCtx();
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      caught = err;
    },
  };

  const chain = compileMiddlewareChain([
    async () => {
      throw new Error("async boom");
    },
  ]);

  await chain(ctx);
  assert.ok(caught instanceof Error);
  assert.equal((caught as Error).message, "async boom");
});
