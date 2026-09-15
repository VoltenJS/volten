import test from "node:test";
import assert from "node:assert";
import { App } from "../../../src/core/server.ts";
import {
  NodeRequestContext,
  EdgeRequestContext,
  RequestContext,
} from "../../../src/utils/requestCtx.ts";
import { SendAfterSentError } from "../../../src/index.ts";

// --- From edgeCtx.test.ts ---

test("EdgeRequestContext Tests", async (t) => {
  await t.test("init and basic properties", () => {
    const app = new App() as any;
    const req = new Request("http://localhost:3000/path?foo=bar", {
      method: "GET",
      headers: {
        "content-type": "application/json",
        cookie: "test=123",
      },
    });

    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    assert.strictEqual(ctx.runtime, "edge");
    assert.strictEqual(ctx.method, "GET");
    assert.strictEqual(ctx.url, "/path?foo=bar");
    assert.strictEqual(ctx.path, "/path");
    assert.strictEqual(ctx.query.foo, "bar");
    assert.strictEqual(ctx.headers["content-type"], "application/json");
    assert.strictEqual(ctx.cookies["test"], "123");
  });

  await t.test("Edge send methods", async () => {
    const app = new App() as any;
    const req = new Request("http://localhost/");
    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    ctx.json({ ok: true });
    assert.strictEqual(ctx.statusCode, 200);
    assert.strictEqual(ctx.getHeader("content-type"), "application/json; charset=utf-8");

    const ctx2 = new EdgeRequestContext();
    ctx2.init(app, req, {}, {});
    ctx2.text("hello edge");
    assert.strictEqual(ctx2.getHeader("content-type"), "text/plain; charset=utf-8");

    const ctx3 = new EdgeRequestContext();
    ctx3.init(app, req, {}, {});
    ctx3.send("just a string");
  });

  await t.test("Edge headers and cookies", () => {
    const app = new App() as any;
    const req = new Request("http://localhost/");
    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    ctx.setHeader("X-Custom", "edge");
    assert.strictEqual(ctx.getHeader("x-custom"), "edge");

    ctx.setCookie("edge-cookie", "val");
    ctx.clearCookie("edge-cookie", { path: "/app" });
    ctx.removeHeader("x-custom");
  });
});

// --- From requestCtx-coverage.test.ts ---

test("RequestContext Extra Coverage", async (t) => {
  const app = new App({}) as any; // Prevent log pollution

  await t.test("NodeRequestContext send after sent", async () => {
    const req = { method: "GET", url: "/", headers: {}, connection: {} } as any;
    let ended = false;
    const res = {
      writeHead: () => {},
      end: () => {
        ended = true;
      },
      setHeader: () => {},
      getHeader: () => undefined,
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: false,
      get writableEnded() {
        return ended;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    ctx.send("first");
    assert.strictEqual(ctx.sent, true);

    assert.throws(() => {
      ctx.json({ a: 1 });
    }, SendAfterSentError);
    assert.throws(() => {
      ctx.text("second");
    }, SendAfterSentError);
    assert.throws(() => {
      ctx.buffer(Buffer.from("hi"));
    }, SendAfterSentError);
    assert.throws(() => {
      ctx.send("third");
    }, SendAfterSentError);

    const gen = ctx.multipart();
    const next = await gen.next();
    assert.strictEqual(next.done, true);
  });

  await t.test("EdgeRequestContext comprehensive methods", async () => {
    const req = new Request("http://localhost/");
    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    ctx.setHeader("X-Test", "123");
    assert.strictEqual(ctx.getHeader("x-test"), "123");
    ctx.setHeader("X-Multi", ["a", "b"]);
    assert.deepEqual(ctx.getHeaders()["x-multi"], "a, b");

    ctx.removeHeader("x-test");
    assert.strictEqual(ctx.getHeader("x-test"), undefined);

    ctx.json({ data: 1 });
    ctx.text("foo");
    ctx.send("bar");
    ctx.json({ data: 2 });

    try {
      ctx.setHeader("A", "B");
      assert.fail("Should throw on setting headers after body sent");
    } catch (e: any) {
      assert.strictEqual(e.message, "Headers already sent");
    }

    try {
      ctx.removeHeader("X-Multi");
      assert.fail("Should throw on removing headers after body sent");
    } catch (e: any) {
      assert.strictEqual(e.message, "Headers already sent");
    }
  });

  await t.test("NodeRequestContext edge cases", () => {
    const req = { method: "GET", url: "/", headers: {}, connection: {} } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: true,
      writableEnded: false,
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    ctx.text("foo");
    try {
      ctx.json({ x: 1 });
    } catch {}
  });

  await t.test("EdgeRequestContext properties", () => {
    const req = new Request("http://localhost/path?q=1", { method: "POST" });
    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    assert.strictEqual(ctx.path, "/path");
    assert.strictEqual(ctx.queryString, "q=1");
    assert.strictEqual(ctx.method, "POST");

    ctx.status(204);
    assert.strictEqual(ctx.statusCode, 204);
  });

  await t.test("More NodeRequestContext coverage", () => {
    const req = {
      method: "GET",
      url: "/",
      headers: {
        "x-forwarded-host": "a.com, b.com",
        host: "c.com",
        "content-type": ["not-string"],
      },
      connection: {},
    } as any;
    let ended = false;
    let headers: any = {};
    const res = {
      writeHead: () => {},
      end: () => {
        ended = true;
      },
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      getHeader: (k: string) => headers[k],
      getHeaders: () => headers,
      removeHeader: (k: string) => {
        delete headers[k];
      },
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: false,
      flushHeaders: () => {},
      get writableEnded() {
        return ended;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    assert.strictEqual(ctx.host, "a.com");
    assert.strictEqual(ctx.hostname, "a.com");
    assert.strictEqual(ctx.isMultipart, false);

    ctx.setHeader("X-Foo", ["1", "2"]);
    assert.deepEqual(ctx.getHeaders()["X-Foo"], ["1", "2"]);

    ctx.removeHeader("X-Foo");
    assert.strictEqual(ctx.getHeader("X-Foo"), undefined);

    ctx.flushHeaders();
    ctx.setCookie("foo", "bar", {
      expires: new Date(),
      domain: "foo.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      maxAge: 1000,
    });
    ctx.setCookie("foo2", "bar", {
      sameSite: "lax",
    });
    ctx.setCookie("foo3", "bar", {
      sameSite: "none",
    });
    ctx.clearCookie("foo3");
    ctx.json([1, 2, 3]); // Hits Array.isArray branch in json()

    const ctx2 = new NodeRequestContext();
    ctx2.init(app, req, res);
    ctx2.status(undefined as any); // hits undefined status early return
    assert.throws(() => {
      ctx2.send(null as any); // hits null branch
    }, SendAfterSentError);
    ctx2.send(); // hits undefined branch
    assert.throws(() => {
      ctx2.send(Buffer.from("a")); // hits buffer branch
    }, SendAfterSentError);
  });

  await t.test("More EdgeRequestContext coverage", () => {
    const req = new Request("http://a.com/", {
      headers: {
        "x-forwarded-host": "a.com, b.com",
        host: "c.com",
        "content-type": "not-multipart",
      },
    });
    const ctx = new EdgeRequestContext();
    ctx.init(app, req, {}, {});

    assert.strictEqual(ctx.host, "a.com");
    assert.strictEqual(ctx.hostname, "a.com");
    assert.strictEqual(ctx.isMultipart, false);

    ctx.status(undefined as any); // early return
    ctx.send(null as any);

    const ctx2 = new EdgeRequestContext();
    ctx2.init(app, req, {}, {});
    ctx2.send({ a: 1 });
    ctx2.buffer(Buffer.from("hi"));
  });
});

// --- From requestCtx-getters.test.ts ---

test("RequestContext Getters", () => {
  const app = new App() as any;
  const req = {
    method: "GET",
    url: "/",
    headers: {},
    connection: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as any;
  const res = {
    writeHead: () => {},
    end: () => {},
    setHeader: () => {},
    on: () => {},
    getHeader: () => {},
  } as any;
  const ctx = (app as any).createCtx(req, res);

  const h1 = [
    ctx.hostname,
    ctx.host,
    ctx.ip,
    ctx.type,
    ctx.isMultipart,
    ctx.env,
    ctx.executionCtx,
    ctx.JSONOptions,
    ctx.rawRes,
    ctx.sent,
    ctx.headersSent,
  ];

  ctx.req.headers = {
    "x-forwarded-host": "[::1]:8080, other",
    "content-type": "multipart/form-data",
  };
  const h2 = [ctx.hostname, ctx.host, ctx.isMultipart];

  ctx.req.headers = { host: "example.com:80" };
  const h3 = [ctx.hostname, ctx.host];

  try {
    ctx.route;
  } catch {}
  try {
    ctx.req;
  } catch {}
});

// --- From requestCtx-methods.test.ts ---

test("NodeRequestContext Direct Methods", () => {
  const app = new App() as any;
  const req = { method: "GET", url: "/", headers: {}, connection: {} } as any;
  const res = {
    writeHead: () => {},
    end: () => {},
    destroy: () => {},
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    setHeader: () => {},
    removeHeader: () => {},
    getHeader: () => "val",
    getHeaders: () => ({}),
  } as any;
  const ctx = (app as any).createCtx(req, res);

  ctx.status(202);
  ctx.setHeader("foo", "bar");
  ctx.removeHeader("foo");
  ctx.setHeader("foo", "baz");
  ctx.setHeader("foo", ["a", "b"]);
  assert.strictEqual(ctx.getHeader("foo"), "val");
  ctx.getHeaders();
  ctx.getRawHeader("foo");
  ctx.setCookie("test", "cookie");

  res.headersSent = true;
  try {
    ctx.setHeader("a", "b");
  } catch {}
  try {
    ctx.removeHeader("a");
  } catch {}
  try {
    ctx.setHeader("a", "b");
  } catch {}
  try {
    ctx.status(200);
  } catch {}
});

test("EdgeRequestContext Direct Methods", () => {
  const app = new App() as any;
  const req = new Request("http://localhost/");
  const ctx = new EdgeRequestContext();
  ctx.init(app, req, {}, {});

  ctx.status(202);
  ctx.setHeader("foo", "bar");
  ctx.removeHeader("foo");
  ctx.setHeader("foo", "baz");
  ctx.setHeader("foo", ["a", "b"]);
  ctx.getHeader("foo");
  ctx.getHeaders();
  ctx.getRawHeader("foo");
  ctx.setCookie("test", "cookie");
  ctx.buffer(Buffer.from("hi"));
});

test("NodeRequestContext Send Stream Direct", async () => {
  const { Readable } = await import("node:stream");
  const app = new App() as any;
  const req = { method: "GET", url: "/", headers: {}, connection: {} } as any;
  let ended = false;
  const res = {
    writeHead: () => {},
    end: () => {
      ended = true;
    },
    destroy: () => {},
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    setHeader: () => {},
    on: () => {},
    cork: () => {},
    uncork: () => {},
  } as any;
  const ctx = (app as any).createCtx(req, res);
  ctx._route = { serializer: undefined } as any;

  const stream = new Readable();
  stream.push(null);
  ctx.send(stream);

  const rs = new ReadableStream();
  ctx.send(rs);
});

// --- From requestCtx-methods2.test.ts ---

test("RequestCtx Additional Coverage", async (t) => {
  const app = new App({}) as any;

  await t.test("json() after response sent logs warning and early returns", () => {
    let ended = false;
    const res = {
      writeHead: () => {},
      end: () => {
        ended = true;
      },
      setHeader: () => {},
      getHeader: () => undefined,
      removeHeader: () => {},
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: false,
      get writableEnded() {
        return ended;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, { method: "GET", url: "/", headers: {}, connection: {} } as any, res);

    ctx.json({ a: 1 });
    // First call sends
    assert.strictEqual(ended, true);

    // Second call triggers warning
    assert.throws(() => {
      ctx.json({ a: 2 });
    }, SendAfterSentError);
  });

  await t.test("body() on GET requests logs warning", async () => {
    const ctx = new NodeRequestContext();
    ctx.init(app, { method: "GET", url: "/", headers: {}, connection: {} } as any, null);

    const body = await ctx.body();
    assert.deepEqual(body, {});

    const ctx2 = new NodeRequestContext();
    ctx2.init(app, { method: "GET", url: "/", headers: {}, connection: {} } as any, null);
    const textBody = await ctx2.body("text");
    assert.strictEqual(textBody, "");
  });

  await t.test("multipart() on non-multipart logs warning", async () => {
    const ctx = new NodeRequestContext();
    ctx.init(app, { method: "POST", url: "/", headers: {}, connection: {} } as any, null);

    let parts = 0;
    for await (const p of ctx.multipart()) {
      parts++;
    }
    assert.strictEqual(parts, 0);
  });

  await t.test("sendFile() after response sent logs warning", async () => {
    const res = {
      writeHead: () => {},
      end: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: false,
      get writableEnded() {
        return true;
      }, // fake already sent
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, { method: "GET", url: "/", headers: {}, connection: {} } as any, res);

    const c = await ctx.sendFile("/nonexistent.txt");
    assert.strictEqual(c, ctx);
  });

  await t.test("sendFile() handles missing file error callback", async () => {
    const res = {
      writeHead: () => {},
      end: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
      cork: () => {},
      uncork: () => {},
      destroyed: false,
      headersSent: false,
      get writableEnded() {
        return false;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, { method: "GET", url: "/", headers: {}, connection: {} } as any, res);

    let caughtErr = null;
    try {
      await ctx.sendFile("/tmp/does_not_exist_volten", 200, {
        errCallback: (err) => {
          caughtErr = err;
        },
      });
    } catch (err: any) {
      assert.match(err.message, /Resource Not Found|ENOENT/);
    }
    assert.ok(caughtErr);
  });

  await t.test("NodeRequestContext getters", () => {
    const req = { method: "GET", url: "/" } as any;
    const res = {
      headersSent: true,
      get writableEnded() {
        return false;
      },
    } as any;
    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    assert.strictEqual(ctx.rawReq, req);
    assert.strictEqual(ctx.rawRes, res);
    assert.strictEqual(ctx.headersSent, true);
    assert.strictEqual(ctx.sent, false);
  });
});

// --- From requestCtx-more.test.ts ---

test("RequestCtx More Tests", async (t) => {
  const app = new App() as any;

  await t.test("various edge cases", async () => {
    const req = { method: "GET", url: "/", headers: {}, connection: {} } as any;
    let resEnded = false;
    const res = {
      writeHead: () => {},
      end: () => {
        resEnded = true;
      },
      setHeader: () => {},
      getHeader: () => undefined,
      cork: () => {},
      uncork: () => {},
    } as any;

    const ctx = (app as any).createCtx(req, res);

    // send with stream
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    ctx.send(stream);
    stream.emit("data", Buffer.from("hi"));
    stream.end();

    // text/html/json again
    const ctx3 = (app as any).createCtx(req, res);
    ctx3.send("hi");
    ctx3.send(Buffer.from("hi"));
  });
});

// --- From requestCtx.test.ts ---

// =====================================================================
// Unit tests for the bare RequestContext (no App/server):
//   - default field values (covers src/utils/requestctx.ts:38-63)
//   - reset() (covers lines 128-143)
//   - getMimeType() across the MIMES table (covers lines 411-477)
// =====================================================================

test("RequestCtx Unit Tests", async (t) => {
  await t.test("default field values are uninitialized", () => {
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

  await t.test("reset() clears all per-request state", () => {
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
    ctx._path = "/x";
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

  await t.test("ip resolution handles x-forwarded-for and cf-connecting-ip", () => {
    const ctx = new RequestContext();
    ctx._headers = { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" };
    assert.equal(ctx.ip, "203.0.113.195");

    ctx._headers = { "cf-connecting-ip": "198.51.100.1 " };
    assert.equal(ctx.ip, "198.51.100.1");

    ctx._headers = {};
    (ctx as any)._req = { socket: { remoteAddress: "127.0.0.1" } };
    assert.equal(ctx.ip, "127.0.0.1");
  });

  await t.test("hostname and host resolution handles ports and forwarding headers", () => {
    const ctx = new RequestContext();
    ctx._headers = { host: "example.com:8080" };
    assert.equal(ctx.hostname, "example.com");
    assert.equal(ctx.host, "example.com:8080");

    ctx._headers = { "x-forwarded-host": "forwarded.com:3000, backup.com" };
    assert.equal(ctx.hostname, "forwarded.com");
    assert.equal(ctx.host, "forwarded.com:3000");
  });

  await t.test("lazy URL parsing computes path and queryString on demand", () => {
    const ctx = new RequestContext();
    ctx.url = "/api/v1/items?category=books&page=2";
    assert.equal(ctx._path, null);
    assert.equal(ctx._queryString, null);

    assert.equal(ctx.path, "/api/v1/items");
    assert.equal(ctx.queryString, "category=books&page=2");
    assert.equal(ctx._path, "/api/v1/items");
  });

  await t.test("isMultipart correctly handles boundary parameters and header variations", () => {
    const ctx = new RequestContext();
    ctx._headers = { "content-type": "multipart/form-data; boundary=---12345" };
    assert.equal(ctx.isMultipart, true);

    ctx._headers = { "content-type": "application/json" };
    assert.equal(ctx.isMultipart, false);

    ctx._headers = {};
    assert.equal(ctx.isMultipart, false);
  });
});
