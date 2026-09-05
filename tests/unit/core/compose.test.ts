import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMiddlewareChain } from "../../../src/core/compose.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

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
    async (_ctx, next) => {
      trace.push("m1:before");
      await next();
      trace.push("m1:after");
    },
    async (_ctx, next) => {
      trace.push("m2:before");
      await next();
      trace.push("m2:after");
    },
    (_ctx) => {
      trace.push("final");
    },
  ]);

  await chain(makeCtx());

  assert.deepEqual(trace, ["m1:before", "m2:before", "final", "m2:after", "m1:after"]);
});

test("compose: middleware can short-circuit by not calling next", async () => {
  const trace: string[] = [];

  const chain = compileMiddlewareChain([
    (_ctx, _next) => {
      trace.push("m1");
      // intentionally short-circuits here
    },
    (_ctx, next) => {
      trace.push("m2");
      next();
    },
    (_ctx) => {
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
    (_ctx, next) => {
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

test("compose: handleHandlerResult handles Web Response in Node runtime", async () => {
  let sentData: unknown = null;
  let headersSet: Record<string, string> = {};
  let statusCodeSet = 200;

  const mockRes = {
    write(chunk: unknown) {
      sentData = chunk;
    },
    end() {},
  };

  const ctx = makeCtx();
  ctx.runtime = "node";
  ctx._res = mockRes as any;
  Object.defineProperty(ctx, "statusCode", {
    set(code: number) {
      statusCodeSet = code;
    },
    get() {
      return statusCodeSet;
    },
  });
  ctx.setHeader = (key: string, val: any) => {
    headersSet[key] = String(val);
  };
  Object.defineProperty(ctx, "sent", {
    get: () => false,
  });

  const webRes = new Response("web response body", {
    status: 201,
    headers: { "x-test-header": "test-val" },
  });

  const chain = compileMiddlewareChain([
    async () => {
      return webRes;
    },
  ]);

  await chain(ctx);
  assert.equal(statusCodeSet, 201);
  assert.equal(headersSet["x-test-header"], "test-val");
});

test("compose: handleHandlerResult handles Web Response in Edge runtime", async () => {
  let edgeResolved: Response | null = null;
  let bodySent = false;

  const ctx = makeCtx();
  ctx.runtime = "edge";
  (ctx as any)._edgeBodySent = false;
  (ctx as any)._resolveEdgeResponse = (res: Response) => {
    edgeResolved = res;
  };
  Object.defineProperty(ctx, "sent", {
    get: () => false,
  });

  const webRes = new Response("edge web response", { status: 202 });

  const chain = compileMiddlewareChain([
    () => {
      return webRes;
    },
  ]);

  await chain(ctx);
  assert.equal((ctx as any)._edgeBodySent, true);
  assert.equal(edgeResolved, webRes);
});
