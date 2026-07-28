import { test, after } from "node:test";
import assert from "node:assert/strict";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

// =====================================================================
// Unit tests for the bare RequestContext (no App/server):
//   - default field values (covers src/utils/requestctx.ts:38-63)
//   - reset() (covers lines 128-143)
//   - getMimeType() across the MIMES table (covers lines 411-477)
// =====================================================================

after(() => {
  setImmediate(() => {
    process.exit(0);
  });
});

test("RequestContext: default field values are uninitialized", () => {
  const ctx = new RequestContext();
  assert.equal(ctx._app, null);
  assert.equal((ctx as any)._req, null);
  assert.equal((ctx as any)._res, null);
  assert.equal(ctx._route, null);
  assert.equal(ctx.headers, null);
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
  ctx.headers = { sentinel: true } as any;
  ctx.inited = true;
  ctx.state["foo"] = "bar";
  ctx.state["nested"] = { x: 1 };
  ctx.params["id"] = "42";
  ctx.method = "POST";
  ctx.url = "/x";
  ctx.path = "/x";
  ctx.host = "example.com";
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
  assert.equal(ctx.headers, null);
  assert.equal(ctx.inited, false);
  assert.deepEqual(ctx.state, {});
  assert.deepEqual(ctx.params, Object.create(null));
  assert.equal(ctx._bodyPromise, undefined);
  assert.equal(ctx.bufferOffset, 0);
  assert.equal((ctx as any).isFlushing, false);
  assert.deepEqual((ctx as any).writeQueue, []);
  assert.equal((ctx as any)._cookiesCache, null);
});

test("RequestContext.getMimeType: text & code MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("html"), "text/html");
  assert.equal(ctx.getMimeType("htm"), "text/html");
  assert.equal(ctx.getMimeType("js"), "text/javascript");
  assert.equal(ctx.getMimeType("mjs"), "text/javascript");
  assert.equal(ctx.getMimeType("css"), "text/css");
  assert.equal(ctx.getMimeType("json"), "application/json");
  assert.equal(ctx.getMimeType("jsonld"), "application/ld+json");
  assert.equal(ctx.getMimeType("txt"), "text/plain; charset=utf-8");
  assert.equal(ctx.getMimeType("xml"), "application/xml");
});
test("RequestContext.getMimeType: image MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("png"), "image/png");
  assert.equal(ctx.getMimeType("jpg"), "image/jpeg");
  assert.equal(ctx.getMimeType("jpeg"), "image/jpeg");
  assert.equal(ctx.getMimeType("gif"), "image/gif");
  assert.equal(ctx.getMimeType("webp"), "image/webp");
  assert.equal(ctx.getMimeType("avif"), "image/avif");
  assert.equal(ctx.getMimeType("svg"), "image/svg+xml");
  assert.equal(ctx.getMimeType("ico"), "image/x-icon");
  assert.equal(ctx.getMimeType("bmp"), "image/bmp");
  assert.equal(ctx.getMimeType("tiff"), "image/tiff");
});

test("RequestContext.getMimeType: font MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("woff"), "font/woff");
  assert.equal(ctx.getMimeType("woff2"), "font/woff2");
  assert.equal(ctx.getMimeType("ttf"), "font/ttf");
  assert.equal(ctx.getMimeType("otf"), "font/otf");
  assert.equal(ctx.getMimeType("eot"), "application/vnd.ms-fontobject");
});

test("RequestContext.getMimeType: video MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("mp4"), "video/mp4");
  assert.equal(ctx.getMimeType("webm"), "video/webm");
  assert.equal(ctx.getMimeType("ogv"), "video/ogg");
  assert.equal(ctx.getMimeType("mov"), "video/quicktime");
  assert.equal(ctx.getMimeType("avi"), "video/x-msvideo");
});

test("RequestContext.getMimeType: audio MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("mp3"), "audio/mpeg");
  assert.equal(ctx.getMimeType("wav"), "audio/wav");
  assert.equal(ctx.getMimeType("flac"), "audio/flac");
  assert.equal(ctx.getMimeType("ogg"), "audio/ogg");
  assert.equal(ctx.getMimeType("m4a"), "audio/mp4");
  assert.equal(ctx.getMimeType("aac"), "audio/aac");
});

test("RequestContext.getMimeType: document MIME types", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("pdf"), "application/pdf");
  assert.equal(ctx.getMimeType("zip"), "application/zip");
  assert.equal(ctx.getMimeType("gz"), "application/gzip");
  assert.equal(ctx.getMimeType("rar"), "application/vnd.rar");
  assert.equal(ctx.getMimeType("7z"), "application/x-7z-compressed");
  assert.equal(ctx.getMimeType("tar"), "application/x-tar");
  assert.equal(ctx.getMimeType("doc"), "application/msword");
  assert.equal(
    ctx.getMimeType("docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(ctx.getMimeType("xls"), "application/vnd.ms-excel");
  assert.equal(
    ctx.getMimeType("xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(ctx.getMimeType("ppt"), "application/vnd.ms-powerpoint");
  assert.equal(
    ctx.getMimeType("pptx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.equal(ctx.getMimeType("csv"), "text/csv");
});

test("RequestContext.getMimeType: binary fallbacks", () => {
  const ctx = new RequestContext();
  assert.equal(ctx.getMimeType("bin"), "application/octet-stream");
  assert.equal(ctx.getMimeType("exe"), "application/octet-stream");
  assert.equal(ctx.getMimeType("wasm"), "application/wasm");
  // Unknown extension falls through to octet-stream
  assert.equal(ctx.getMimeType("xyz_unknown"), "application/octet-stream");
  // Case-insensitive lookup (the function lowercases the input)
  assert.equal(ctx.getMimeType("PNG"), "image/png");
  assert.equal(ctx.getMimeType("JSON"), "application/json");
});
