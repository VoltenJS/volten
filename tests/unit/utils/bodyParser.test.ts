import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable, PassThrough } from "node:stream";
import type { AddressInfo } from "node:net";
import { App } from "../../../src/core/server.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";
import { parseBody, parseMultipartStream } from "../../../src/utils/bodyParser.ts";
import { PayloadTooLargeError } from "../../../src/core/errors.ts";

// Helper: build a minimal mock req/res pair for direct parseBody calls.
function makeReqRes(headers: Record<string, string>, chunks: Buffer[] = []) {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {
    data: [],
    end: [],
    error: [],
  };
  const req = {
    headers,
    on(ev: string, cb: (...a: unknown[]) => void) {
      (listeners[ev] ||= []).push(cb);
      return this;
    },
    off(ev: string, cb: (...a: unknown[]) => void) {
      if (listeners[ev]) {
        listeners[ev] = listeners[ev].filter((c) => c !== cb);
      }
      return this;
    },
    emit(ev: string, ...args: unknown[]) {
      for (const cb of listeners[ev] || []) cb(...args);
    },
    destroy() {
      /* noop */
    },
  };
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(_s: number, _h?: unknown) {
      return this;
    },
    end(_b?: unknown) {
      this.writableEnded = true;
      return this;
    },
  };
  // Schedule emission of chunks
  queueMicrotask(() => {
    for (const c of chunks) req.emit("data", c);
    req.emit("end");
  });
  return { req, res };
}

test("parseBody: rejects multipart/form-data explicitly", async () => {
  const app = new App({ noLogs: true });
  const { req, res } = makeReqRes({
    "content-type": "multipart/form-data; boundary=---xyz",
  });
  const ctx = new RequestContext();
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  ctx._route = {
    bodyLimit: 1024,
    method: "POST",
    middleware: [],
    handler: () => {},
    composeChain: () => {},
    lastFingerprint: 0,
    setFingerprint: () => {},
    setDeOpt: () => {},
    disableOpt: false,
    methodStorage: { get: () => null, set: () => {} } as any,
  } as any;
  await assert.rejects(() => parseBody.call(app, ctx, false), /multipart\/form-data/);
  app.close();
});

test("parseBody: returns empty object for Content-Length: 0", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({ "content-length": "0" });
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, false);
  assert.deepEqual(body, {});
  app.close();
});

test("parseBody: rejects Content-Length above limit with 413", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    end() {
      this.writableEnded = true;
      return this;
    },
  };
  const { req } = makeReqRes({ "content-length": "9999" });
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  await assert.rejects(
    () => parseBody.call(app, ctx, false, 100),
    (err: unknown) => err instanceof PayloadTooLargeError,
  );
  app.close();
});

test("parseBody: parses JSON body when content-type is application/json", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({ "content-type": "application/json" }, [
    Buffer.from('{"hello":"world"}'),
  ]);
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, false);
  assert.deepEqual(body, { hello: "world" });
  app.close();
});

test("parseBody: parses raw text body when text=true", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({ "content-type": "text/plain" }, [
    Buffer.from("plain text payload"),
  ]);
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, true);
  assert.equal(body, "plain text payload");
  app.close();
});

test("parseBody: parses urlencoded text body correctly (with fastParseUrlEncoded)", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({ "content-type": "application/x-www-form-urlencoded" }, [
    Buffer.from("a=1&b=2"),
  ]);
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, false);
  const nullObject = Object.create(null);
  Object.assign(nullObject, { a: "1", b: "2" });
  assert.deepEqual(body, nullObject);
  app.close();
});

test("parseBody: rejects with PayloadTooLargeError when streaming exceeds limit", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  // Build a req that emits many chunks
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {
    data: [],
    end: [],
    error: [],
  };
  const req = {
    headers: {},
    on(ev: string, cb: (...a: unknown[]) => void) {
      (listeners[ev] ||= []).push(cb);
      return this;
    },
    off(ev: string, cb: (...a: unknown[]) => void) {
      if (listeners[ev]) {
        listeners[ev] = listeners[ev].filter((c) => c !== cb);
      }
      return this;
    },
    destroy() {
      /* noop */
    },
  };
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead() {
      return this;
    },
    end() {
      return this;
    },
  };
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;

  setImmediate(() => {
    for (let i = 0; i < 5; i++) {
      for (const cb of listeners["data"] ?? []) cb(Buffer.from("X".repeat(30)));
    }
  });

  await assert.rejects(
    () => parseBody.call(app, ctx, false, 100),
    (err: unknown) => err instanceof PayloadTooLargeError,
  );
  app.close();
});

test("parseBody: returns empty object when stream ends with zero chunks", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({});
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, false);
  assert.deepEqual(body, {});
  app.close();
});

test("parseBody: end handler runs cleanup and resolves empty object", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req, res } = makeReqRes({ "content-type": "application/json" }, []);
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  const body = await parseBody.call(app, ctx, false);
  assert.deepEqual(body, {});
  app.close();
});

test("parseBody: uses route.bodyLimit when present", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  ctx._route = {
    bodyLimit: 50,
    method: "POST",
    middleware: [],
    handler: () => {},
    composeChain: () => {},
    lastFingerprint: 0,
    setFingerprint: () => {},
    setDeOpt: () => {},
    disableOpt: false,
    methodStorage: { get: () => null, set: () => {} } as any,
  } as any;
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    end() {
      this.writableEnded = true;
      return this;
    },
  };
  const { req } = makeReqRes({ "content-length": "1000" });
  (ctx as any)._req = req as any;
  (ctx as any)._res = res as any;
  ctx._app = app;
  await assert.rejects(
    () => parseBody.call(app, ctx, false),
    (err: unknown) => err instanceof PayloadTooLargeError,
  );
  app.close();
});

// =========================================================================
// parseMultipartStream tests
// =========================================================================

function makeMultipartReq(
  contentType: string,
  body: Buffer,
): {
  req: any;
  readable: PassThrough;
} {
  const readable = new PassThrough();
  (readable as any).headers = { "content-type": contentType };
  readable.end(body);
  return { req: readable, readable };
}

test("parseMultipartStream: throws when boundary is missing", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const { req } = makeMultipartReq("multipart/form-data", Buffer.from(""));
  (ctx as any)._req = req;
  ctx._app = app;
  await assert.rejects(() => parseMultipartStream.call(app, ctx).next(), /No boundary/);
  app.close();
});

test("parseMultipartStream: yields a text field and finishes", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "----TestBoundary123";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="greeting"\r\n` +
      `\r\n` +
      `hello world\r\n` +
      `--${boundary}--\r\n`,
  );
  const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
  (ctx as any)._req = req;
  ctx._app = app;

  const parts: any[] = [];
  for await (const part of parseMultipartStream.call(app, ctx)) {
    parts.push(part);
  }
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, "greeting");
  assert.equal(parts[0].value, "hello world");
  app.close();
});

test("parseMultipartStream: yields multiple text fields in order", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "BOUND";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="a"\r\n` +
      `\r\nfirst\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="b"\r\n` +
      `\r\nsecond\r\n` +
      `--${boundary}--\r\n`,
  );
  const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
  (ctx as any)._req = req;
  ctx._app = app;

  const parts: any[] = [];
  for await (const part of parseMultipartStream.call(app, ctx)) {
    parts.push(part);
  }
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, "a");
  assert.equal(parts[0].value, "first");
  assert.equal(parts[1].name, "b");
  assert.equal(parts[1].value, "second");
  app.close();
});

test("parseMultipartStream: yields a file part with content-type header", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "FILEBOUND";
  const fileContent = "file body content here";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="upload"; filename="hello.txt"\r\n` +
      `Content-Type: text/plain\r\n` +
      `\r\n` +
      `${fileContent}\r\n` +
      `--${boundary}--\r\n`,
  );
  const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
  (ctx as any)._req = req;
  ctx._app = app;

  const parts: any[] = [];
  for await (const part of parseMultipartStream.call(app, ctx)) {
    parts.push(part);
  }
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, "upload");
  assert.equal(parts[0].filename, "hello.txt");
  assert.equal(parts[0].contentType, "text/plain");
  // Read the stream to verify the buffered content
  const chunks: Buffer[] = [];
  for await (const c of parts[0].stream) {
    chunks.push(c as Buffer);
  }
  assert.equal(Buffer.concat(chunks).toString("utf8"), fileContent);
  app.close();
});

test("parseMultipartStream: file part save() writes the streamed content to disk", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "FILEBOUND_SAVE";
  const fileContent = "saveable content";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="data.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n` +
      `\r\n` +
      `${fileContent}\r\n` +
      `--${boundary}--\r\n`,
  );
  const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
  (ctx as any)._req = req;
  ctx._app = app;

  let savedPath = "";
  let savedContent = "";
  for await (const part of parseMultipartStream.call(app, ctx)) {
    if (part.isFile) {
      savedPath = `/tmp/volten-multipart-save-${Date.now()}.bin`;
      await part.save(savedPath);
    }
  }
  // Read the file back
  const { readFileSync, unlinkSync } = await import("node:fs");
  savedContent = readFileSync(savedPath, "utf8");
  unlinkSync(savedPath);
  assert.equal(savedContent, fileContent);
  app.close();
});

test("parseMultipartStream: supports quoted boundary parameter", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "QBOUND";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="x"\r\n` +
      `\r\nval\r\n` +
      `--${boundary}--\r\n`,
  );
  const { req } = makeMultipartReq(`multipart/form-data; boundary="${boundary}"`, body);
  (ctx as any)._req = req;
  ctx._app = app;

  const parts: any[] = [];
  for await (const part of parseMultipartStream.call(app, ctx)) {
    parts.push(part);
  }
  assert.equal(parts[0].value, "val");
  app.close();
});

test("parseMultipartStream: handles split chunks (data spans multiple buffers)", async () => {
  const app = new App({ noLogs: true });
  const ctx = new RequestContext();
  const boundary = "SPLITBND";
  const fullBody = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="f"\r\n` +
      `\r\nvalue123\r\n` +
      `--${boundary}--\r\n`,
  );
  // Split into 3 random-sized chunks
  const a = fullBody.subarray(0, 10);
  const b = fullBody.subarray(10, 25);
  const c = fullBody.subarray(25);

  const readable = Readable.from([a, b, c]);
  (readable as any).headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  (ctx as any)._req = readable;
  ctx._app = app;

  const parts: any[] = [];
  for await (const part of parseMultipartStream.call(app, ctx)) {
    parts.push(part);
  }
  assert.equal(parts.length, 1);
  assert.equal(parts[0].value, "value123");
  app.close();
});

// =========================================================================
// Integration: parseBody via the framework with no Content-Length (covers
// the request that exercises the no-cl, no-content-type branch with chunks).
// =========================================================================
test("parseBody: real HTTP request with body but no Content-Length header", async () => {
  const app = new App({ noLogs: true, RequestPoolSize: 4 });
  app.post("/body", async (ctx) => {
    const body = await ctx.body("text");
    ctx.text(String(body));
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  if (!address) {
    throw new Error("Server address is null");
  }
  const port = address.port;

  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port,
        path: "/body",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
        agent: false,
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode || 0));
      },
    );
    req.on("error", reject);
    req.write('{"a":1}');
    req.end();
  });

  await new Promise<void>((resolve) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
  assert.equal(status, 200);
  app.close();
});
