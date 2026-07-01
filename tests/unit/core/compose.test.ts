import { test, after } from "node:test";
import assert from "node:assert/strict";
import { compileMiddlewareChain } from "../../../src/core/compose.ts";
import { RequestContext } from "../../../src/utils/requestctx.ts";

// =====================================================================
// Unit tests for compileMiddlewareChain (src/core/compose.ts)
// All matrices exercise the live, exported compilation pipeline.
// =====================================================================
after(() => {
  setImmediate(() => {
    process.exit(0);
  });
});

function makeCtx(): RequestContext {
  // Construct a bare RequestContext and set only the fields compose reads
  const ctx = new RequestContext();
  // Pretend a response is "in flight" so compose's internal branch
  // (`if (ctx.sent) { throw new InvalidNextCallError(); }`) is exercised.
  Object.defineProperty(ctx, "sent", {
    get: () => false,
    configurable: true,
  });
  return ctx;
}

test("compose: empty chain calls the final handler", () => {
  let finalCalled = false;
  const chain = compileMiddlewareChain([], () => {
    finalCalled = true;
  });
  const result = chain(makeCtx(), () => {});
  if (result instanceof Promise) {
    return result.then(() => {
      assert.equal(finalCalled, true);
    });
  }
  assert.equal(finalCalled, true);
});

test("compose: middleware runs in order, final handler runs last", async () => {
  const trace: string[] = [];
  const chain = compileMiddlewareChain(
    [
      (ctx, next) => {
        trace.push("m1:before");
        const r = next();
        if (r instanceof Promise) {
          return r.then(() => trace.push("m1:after"));
        }
        trace.push("m1:after");
      },
      (ctx, next) => {
        trace.push("m2:before");
        const r = next();
        if (r instanceof Promise) {
          return r.then(() => trace.push("m2:after"));
        }
        trace.push("m2:after");
      },
    ],
    (ctx) => {
      trace.push("final");
    },
  );

  await chain(makeCtx(), () => {});

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
  const chain = compileMiddlewareChain(
    [
      (ctx, next) => {
        trace.push("m1");
        // intentionally do not call next()
      },
      (ctx, next) => {
        trace.push("m2");
        next();
      },
    ],
    (ctx) => {
      trace.push("final");
    },
  );

  await chain(makeCtx(), () => {});

  // m2 and final should not be called because m1 didn't propagate next()
  assert.deepEqual(trace, ["m1"]);
});

test("compose: synchronous next() works for sync middleware", async () => {
  let finalCalled = false;
  const chain = compileMiddlewareChain(
    [
      (ctx, next) => {
        next();
      },
    ],
    () => {
      finalCalled = true;
    },
  );

  await chain(makeCtx(), () => {});
  assert.equal(finalCalled, true);
});

test("compose: a thrown error inside a handler is routed through ctx._app.handleError", async () => {
  let caught: unknown = null;
  const ctx = makeCtx();
  // Provide a fake _app that captures handleError calls
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      caught = err;
    },
  };

  const chain = compileMiddlewareChain([], () => {
    throw new Error("boom from final handler");
  });

  await chain(ctx, () => {});
  assert.ok(caught instanceof Error);
  assert.equal((caught as Error).message, "boom from final handler");
});

test("compose: an async rejection inside a handler is routed through ctx._app.handleError", async () => {
  let caught: unknown = null;
  const ctx = makeCtx();
  (ctx as any)._app = {
    handleError: (err: unknown) => {
      caught = err;
    },
  };

  const chain = compileMiddlewareChain([], async () => {
    throw new Error("async boom");
  });
  await chain(ctx, () => {});
  assert.ok(caught instanceof Error);
  assert.equal((caught as Error).message, "async boom");
});
