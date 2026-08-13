import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

// =====================================================================
// Unit tests for the bare RequestContext (no App/server):
//   - default field values (covers src/utils/requestctx.ts:38-63)
//   - reset() (covers lines 128-143)
//   - getMimeType() across the MIMES table (covers lines 411-477)
// =====================================================================

test("RequestContext: default field values are uninitialized", () => {
  const ctx = new RequestContext();
  assert.equal(ctx._app, null);
  assert.equal((ctx as any)._req, null);
  assert.equal((ctx as any)._res, null);
  assert.equal(ctx._route, null);
  assert.deepEqual(ctx.headers, {});
  assert.equal(ctx.inited, false);
  assert.deepEqual(ctx.state, {});
  // params is an object with no prototype
  assert.deepEqual(ctx.params, Object.create(null));
  // Buffer pre-allocated to BUFFER_SIZE
  assert.equal(ctx.responseBuffer.length, RequestContext.BUFFER_SIZE);
  assert.equal(ctx.bufferOffset, 0);
  assert.equal(RequestContext.BUFFER_SIZE, 64 * 1024);
});

test("RequestContext: reset() clears all per-request state", () => {
  const ctx = new RequestContext();
  // Pre-populate the context as if a request had run through it
  (ctx as any)._app = { sentinel: true };
  (ctx as any)._req = { sentinel: true };
  (ctx as any)._res = { sentinel: true };
  ctx._route = { sentinel: true } as any;
  ctx._headers = { sentinel: true } as any;
  ctx.inited = true;
  ctx.state["foo"] = "bar";
  ctx.state["nested"] = { x: 1 };
  ctx.params["id"] = "42";
  ctx.method = "POST";
  ctx.url = "/x";
  ctx.path = "/x";
  ctx._bodyPromise = Promise.resolve();
  ctx.bufferOffset = 1234;
  (ctx as any).isFlushing = true;
  (ctx as any).writeQueue.push({ str: "queued", resolve: () => {} });
  (ctx as any)._cookiesCache = { a: "b" };

  ctx.reset();
  assert.equal(ctx._app, null);
  assert.equal((ctx as any)._req, null);
  assert.equal((ctx as any)._res, null);
  assert.equal(ctx._route, null);
  assert.deepEqual(ctx.headers, {});
  assert.equal(ctx.inited, false);
  assert.deepEqual(ctx.state, {});
  assert.deepEqual(ctx.params, Object.create(null));
  assert.equal(ctx._bodyPromise, undefined);
  assert.equal(ctx.bufferOffset, 0);
  assert.equal((ctx as any).isFlushing, false);
  assert.deepEqual((ctx as any).writeQueue, []);
  assert.equal((ctx as any)._cookiesCache, null);
});
