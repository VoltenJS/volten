import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, PassThrough } from "node:stream";
import { App } from "../../../src/core/server.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";
import { request } from "../../helpers.ts";
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

test("BodyParser Unit Tests", async (t) => {
  await t.test("rejects multipart/form-data explicitly", async () => {
    const app = new App<any>({});
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

  await t.test("returns empty object for Content-Length: 0", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const { req, res } = makeReqRes({ "content-length": "0" });
    (ctx as any)._req = req as any;
    (ctx as any)._res = res as any;
    ctx._app = app;
    const body = await parseBody.call(app, ctx, false);
    assert.deepEqual(body, {});
    app.close();
  });

  await t.test("rejects Content-Length above limit with 413", async () => {
    const app = new App<any>({});
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

  await t.test("parses JSON body when content-type is application/json", async () => {
    const app = new App<any>({});
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

  await t.test("parses raw text body when text=true", async () => {
    const app = new App<any>({});
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

  await t.test("parses urlencoded text body correctly (with fastParseUrlEncoded)", async () => {
    const app = new App<any>({});
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

  await t.test("rejects with PayloadTooLargeError when streaming exceeds limit", async () => {
    const app = new App<any>({});
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

  await t.test("returns empty object when stream ends with zero chunks", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const { req, res } = makeReqRes({});
    (ctx as any)._req = req as any;
    (ctx as any)._res = res as any;
    ctx._app = app;
    const body = await parseBody.call(app, ctx, false);
    assert.deepEqual(body, {});
    app.close();
  });

  await t.test("end handler runs cleanup and resolves empty object", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const { req, res } = makeReqRes({ "content-type": "application/json" }, []);
    (ctx as any)._req = req as any;
    (ctx as any)._res = res as any;
    ctx._app = app;
    const body = await parseBody.call(app, ctx, false);
    assert.deepEqual(body, {});
    app.close();
  });

  await t.test("uses route.bodyLimit when present", async () => {
    const app = new App<any>({});
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

  await t.test("throws when boundary is missing", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const { req } = makeMultipartReq("multipart/form-data", Buffer.from(""));
    (ctx as any)._req = req;
    ctx._app = app;
    await assert.rejects(() => parseMultipartStream.call(app, ctx).next(), /No boundary/);
    app.close();
  });

  await t.test("yields a text field and finishes", async () => {
    const app = new App<any>({});
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

  await t.test("yields multiple text fields in order", async () => {
    const app = new App<any>({});
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

  await t.test("yields a file part with content-type header", async () => {
    const app = new App<any>({});
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

  await t.test("file part save() writes the streamed content to disk", async () => {
    const app = new App<any>({});
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

  await t.test("supports quoted boundary parameter", async () => {
    const app = new App<any>({});
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

  await t.test("handles split chunks (data spans multiple buffers)", async () => {
    const app = new App<any>({});
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
  await t.test("real HTTP request with body but no Content-Length header", async () => {
    const app = new App<any>({ RequestPoolSize: 4 });
    app.post("/body", async (ctx) => {
      const body = await ctx.body("text");
      ctx.text(String(body));
    });

    const res = await request(app, "/body", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
      },
      body: '{"a":1}',
    });

    assert.equal(res.status, 200);
  });

  await t.test("real HTTP request with urlencoded body", async () => {
    const app = new App<any>({});
    app.post("/url", async (ctx) => {
      const body = await ctx.body();
      ctx.json(body);
    });

    const res = await request(app, "/url", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "foo=bar&baz=1",
    });

    assert.deepEqual(res.json(), { foo: "bar", baz: "1" });
  });

  await t.test("real HTTP request with invalid json body returns 400", async () => {
    const app = new App<any>({ loggerOptions: { level: "fatal" } });
    app.post("/json", async (ctx) => {
      const body = await ctx.body();
      ctx.json({ raw: body });
    });

    const res = await request(app, "/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{badjson:",
    });

    assert.equal(res.status, 400);
    assert.ok(res.body.includes("Malformed JSON"));
  });

  await t.test("real HTTP request with unsupported media type returns 415", async () => {
    const app = new App<any>({ loggerOptions: { level: "fatal" } });
    app.post("/json", async (ctx) => {
      await ctx.body();
      ctx.text("ok");
    });

    const res = await request(app, "/json", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    });

    assert.equal(res.status, 415);
  });

  await t.test(
    "urlencoded parsing handles key without value and multiple array values",
    async () => {
      const app = new App<any>({ loggerOptions: { level: "fatal" } });
      app.post("/url", async (ctx) => {
        const b = await ctx.body();
        ctx.json(b);
      });

      const res = await request(app, "/url", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "solo&tag=a&tag=b&tag=c",
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), { solo: "", tag: ["a", "b", "c"] });
      await app.close();
    },
  );

  await t.test("multipart parsing throws on missing boundary header", async () => {
    const app = new App<any>({ loggerOptions: { level: "fatal" } });
    const ctx = new RequestContext();
    (ctx as any)._req = { headers: { "content-type": "multipart/form-data" } };
    ctx._app = app;

    await assert.rejects(async () => {
      for await (const _part of parseMultipartStream(ctx)) {
      }
    }, /No boundary found/);
    await app.close();
  });

  await t.test("multipart parsing enforces maxParts, maxFields, maxFieldSize", async () => {
    const app = new App<any>({
      multipart: { maxParts: 1, maxFields: 1, maxFieldSize: 5 },
      loggerOptions: { level: "fatal" },
    });

    // 1. Exceeding maxParts (two file parts)
    const boundary = "---------------------------974767299852498929531610575";
    const bodyMultiParts =
      `--${boundary}\r\nContent-Disposition: form-data; name="f1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="f2"; filename="b.txt"\r\nContent-Type: text/plain\r\n\r\nworld\r\n` +
      `--${boundary}--\r\n`;

    app.post("/multi-parts", async (ctx) => {
      try {
        for await (const part of ctx.multipart()) {
          if (part.isFile) await part.buffer();
        }
        ctx.send("ok");
      } catch (err: any) {
        ctx.status(400).send(err.message);
      }
    });

    const resParts = await request(app, "/multi-parts", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: bodyMultiParts,
    });
    assert.ok(resParts.body.includes("Too many multipart parts"));

    // 2. Exceeding maxFieldSize
    const bodyBigField =
      `--${boundary}\r\nContent-Disposition: form-data; name="field1"\r\n\r\nTOO_LONG_FOR_LIMIT\r\n` +
      `--${boundary}--\r\n`;

    app.post("/multi-field", async (ctx) => {
      try {
        for await (const _part of ctx.multipart()) {
        }
        ctx.send("ok");
      } catch (err: any) {
        ctx.status(400).send(err.message);
      }
    });

    const resField = await request(app, "/multi-field", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: bodyBigField,
    });
    assert.ok(resField.body.includes("Field too large"));

    await app.close();
  });

  await t.test("rejects when socket closes before body ends", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    const req = {
      headers: {},
      on(ev: string, cb: (...a: unknown[]) => void) {
        (listeners[ev] ||= []).push(cb);
        return this;
      },
      off(ev: string, cb: (...a: unknown[]) => void) {
        if (listeners[ev]) listeners[ev] = listeners[ev].filter((c) => c !== cb);
        return this;
      },
      destroy() {},
    };
    (ctx as any)._req = req as any;
    (ctx as any)._res = {} as any;
    ctx._app = app;
    queueMicrotask(() => {
      for (const cb of listeners["data"] || []) cb(Buffer.from("part"));
      for (const cb of listeners["close"] || []) cb();
    });
    await assert.rejects(
      () => parseBody.call(app, ctx, false),
      /Client disconnected before body was fully received/,
    );
    app.close();
  });

  await t.test("rejects when req emits error", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    const req = {
      headers: {},
      on(ev: string, cb: (...a: unknown[]) => void) {
        (listeners[ev] ||= []).push(cb);
        return this;
      },
      off(ev: string, cb: (...a: unknown[]) => void) {
        if (listeners[ev]) listeners[ev] = listeners[ev].filter((c) => c !== cb);
        return this;
      },
      destroy() {},
    };
    (ctx as any)._req = req as any;
    (ctx as any)._res = {} as any;
    ctx._app = app;
    queueMicrotask(() => {
      for (const cb of listeners["error"] || []) cb(new Error("socket network error"));
    });
    await assert.rejects(() => parseBody.call(app, ctx, false), /socket network error/);
    app.close();
  });

  await t.test("rejects when requestTimeoutMs is exceeded", async (t) => {
    const TIMEOUT_MS = 10;
    const app = new App<any>({ requestTimeoutMs: TIMEOUT_MS });
    try {
      const ctx = new RequestContext();
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      let destroyed = false;

      const req = {
        headers: {},
        socket: { setTimeout() {}, destroy() {} },
        readable: true,
        readableEnded: false,
        aborted: false,
        setTimeout() {
          return this;
        },
        pause() {
          return this;
        },
        resume() {
          return this;
        },
        on(ev: string, cb: (...a: unknown[]) => void) {
          (listeners[ev] ||= []).push(cb);
          return this;
        },
        off(ev: string, cb: (...a: unknown[]) => void) {
          if (listeners[ev]) listeners[ev] = listeners[ev].filter((c) => c !== cb);
          return this;
        },
        removeListener(ev: string, cb: (...a: unknown[]) => void) {
          return this.off(ev, cb);
        },
        once(ev: string, cb: (...a: unknown[]) => void) {
          const wrap = (...args: unknown[]) => {
            this.off(ev, wrap);
            cb(...args);
          };
          return this.on(ev, wrap);
        },
        destroy() {
          destroyed = true;
        },
      };

      (ctx as any)._req = req as any;
      (ctx as any)._res = {} as any;
      ctx._app = app;

      // Deterministic time. No wall clock, no CI jitter.
      t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

      const promise = parseBody.call(app, ctx, false);

      // Advance time past the timeout. This synchronously fires the timer
      // callback, which should reject the parseBody promise.
      t.mock.timers.tick(TIMEOUT_MS + 1);

      let caught: unknown;
      try {
        await promise;
        assert.fail("parseBody should have rejected");
      } catch (err) {
        caught = err;
      }

      assert.ok(
        caught instanceof Error,
        `Expected Error, got ${Object.prototype.toString.call(caught)}`,
      );
      assert.match(caught.message, /Request body timed out/);
      assert.strictEqual(destroyed, true, "req.destroy() must be called on timeout");
    } finally {
      await app.close();
    }
  });

  await t.test("file part text() and buffer() methods return content", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const boundary = "BND_TEXT_BUFFER";
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="f"; filename="test.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `sample content\r\n` +
        `--${boundary}--\r\n`,
    );
    const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
    (ctx as any)._req = req;
    ctx._app = app;
    for await (const part of parseMultipartStream.call(app, ctx)) {
      if (part.isFile) {
        const textContent = await part.text();
        assert.equal(textContent, "sample content");
      }
    }
    app.close();
  });

  await t.test("multipart exceeds maxTotalBytes throws PayloadTooLargeError", async () => {
    const app = new App<any>({ multipart: { maxTotalBytes: 20 } });
    const ctx = new RequestContext();
    const boundary = "BND_TOO_BIG";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="f"\r\n\r\n` +
        "this is way too long for twenty bytes\r\n" +
        `--${boundary}--\r\n`,
    );
    const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
    (ctx as any)._req = req;
    ctx._app = app;
    await assert.rejects(
      async () => {
        for await (const _ of parseMultipartStream.call(app, ctx)) {
        }
      },
      (err: unknown) => err instanceof PayloadTooLargeError,
    );
    app.close();
  });

  await t.test("multipart exceeds maxHeaderSize throws error", async () => {
    const app = new App<any>({ multipart: { maxHeaderSize: 10 } });
    const ctx = new RequestContext();
    const boundary = "BND_HDR_BIG";
    const readable = new PassThrough();
    (readable as any).headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    (ctx as any)._req = readable;
    ctx._app = app;

    readable.write(`--${boundary}\r\nContent-Disposition: `);
    readable.write(`form-data; name="${"x".repeat(50)}`);

    await assert.rejects(async () => {
      for await (const _ of parseMultipartStream.call(app, ctx)) {
      }
    }, /Multipart header too large/);
    app.close();
  });

  await t.test("multipart exceeds maxFileSize throws error", async () => {
    const app = new App<any>({ multipart: { maxFileSize: 5 } });
    const ctx = new RequestContext();
    const boundary = "BND_FILE_BIG";
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="f"; filename="huge.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n` +
        `long file content exceeding limit\r\n` +
        `--${boundary}--\r\n`,
    );
    const { req } = makeMultipartReq(`multipart/form-data; boundary=${boundary}`, body);
    (ctx as any)._req = req;
    ctx._app = app;
    await assert.rejects(async () => {
      for await (const part of parseMultipartStream.call(app, ctx)) {
        if (part.isFile) await part.buffer();
      }
    }, /File too large/);
    app.close();
  });

  await t.test("multipart handles client disconnect", async () => {
    const app = new App<any>({});
    const ctx = new RequestContext();
    const boundary = "BND_DISCONNECT";
    const readable = new PassThrough();
    (readable as any).headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    (ctx as any)._req = readable;
    ctx._app = app;
    readable.write(`--${boundary}\r\nContent-Disposition: form-data; name="f"\r\n\r\n`);
    queueMicrotask(() => {
      readable.emit("close");
    });
    await assert.rejects(async () => {
      for await (const _ of parseMultipartStream.call(app, ctx)) {
      }
    }, /Client disconnected during multipart upload/);
    app.close();
  });
});
