import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../../src/core/server.ts";
import { isEdge, setIsEdge } from "../../../src/utils/isEdge.ts";
import { compileMiddlewareChain, createDynamicMiddlewareChain } from "../../../src/core/compose.ts";
import { voltJson, compileVoltJson } from "../../../src/utils/stringifyJson.ts";
import { RouteTree } from "../../../src/utils/routeTree.ts";
import { InvalidNextCallError } from "../../../src/core/errors.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

test("Edge runtime: createFetch returns a fetch function", () => {
  const app = new App();
  const fetchHandler = app.createFetch();
  assert.equal(typeof fetchHandler, "function");
});

test("Edge runtime: matches routes and handles standard requests/responses", async () => {
  const app = new App();
  app.get("/hello", (ctx) => {
    ctx.text("Hello Edge!");
  });

  const fetchHandler = app.createFetch();
  const request = new Request("https://example.com/hello");
  const response = await fetchHandler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "Hello Edge!");
});

test("Edge runtime: supports return value ergonomics", async () => {
  const app = new App();
  app.get("/json", () => {
    return { ok: true, runtime: "edge" };
  });

  app.get("/string", () => {
    return "string response";
  });

  app.get("/raw-response", () => {
    return new Response("custom", { status: 201 });
  });

  const fetchHandler = app.createFetch();

  // Test JSON object return
  const res1 = await fetchHandler(new Request("https://example.com/json"));
  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await res1.json(), { ok: true, runtime: "edge" });

  // Test String return
  const res2 = await fetchHandler(new Request("https://example.com/string"));
  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await res2.text(), "string response");

  // Test Raw standard Response return
  const res3 = await fetchHandler(new Request("https://example.com/raw-response"));
  assert.equal(res3.status, 201);
  assert.equal(await res3.text(), "custom");
});

test("Edge runtime: parses request JSON body natively", async () => {
  const app = new App();
  app.post("/post-json", async (ctx) => {
    const body = await ctx.body();
    ctx.json({ body });
  });

  const fetchHandler = app.createFetch();
  const req = new Request("https://example.com/post-json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  const res = await fetchHandler(req);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { body: { hello: "world" } });
});

test("Edge runtime: parses request URL encoded body natively", async () => {
  const app = new App();
  app.post("/post-form", async (ctx) => {
    const body = await ctx.body();
    ctx.json({ body });
  });

  const fetchHandler = app.createFetch();
  const req = new Request("https://example.com/post-form", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "foo=bar&baz=qux",
  });
  const res = await fetchHandler(req);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { body: { foo: "bar", baz: "qux" } });
});

test("Edge runtime: attaches env and executionCtx to context", async () => {
  const app = new App();
  app.get("/bindings", (ctx) => {
    assert.deepEqual(ctx.env, { MY_KV: "kv-val" });
    assert.deepEqual(ctx.executionCtx, { mockCtx: true });
    ctx.text("bindings validated");
  });

  const fetchHandler = app.createFetch();
  const res = await fetchHandler(
    new Request("https://example.com/bindings"),
    { MY_KV: "kv-val" },
    { mockCtx: true },
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "bindings validated");
});

test("Edge runtime: cookie handling and multiple Set-Cookie headers", async () => {
  const app = new App();
  app.get("/cookies", (ctx) => {
    assert.equal(ctx.cookies["session"], "xyz");
    ctx.setCookie("cookie1", "val1", { httpOnly: true });
    ctx.setCookie("cookie2", "val2", { secure: true });
    ctx.text("cookies processed");
  });

  const fetchHandler = app.createFetch();
  const req = new Request("https://example.com/cookies", {
    headers: { Cookie: "session=xyz" },
  });
  const res = await fetchHandler(req);
  assert.equal(res.status, 200);

  // Web Headers object returns comma-separated or multiple Set-Cookie headers
  // Headers.get() normally combines them or gets the first, but let's check
  const setCookie = res.headers.get("Set-Cookie");
  assert.ok(setCookie?.includes("cookie1=val1"));
  assert.ok(setCookie?.includes("cookie2=val2"));
});

test("Edge runtime: isEdge detection and override", () => {
  setIsEdge(null);
  const original = isEdge();
  assert.equal(typeof original, "boolean");

  setIsEdge(true);
  assert.equal(isEdge(), true);

  setIsEdge(false);
  assert.equal(isEdge(), false);

  setIsEdge(null);

  // Test EdgeRuntime detection
  (globalThis as any).EdgeRuntime = "edge-runtime";
  assert.equal(isEdge(), true);
  delete (globalThis as any).EdgeRuntime;

  // Test Cloudflare Workers navigator userAgent
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla Cloudflare-Workers" },
    configurable: true,
    writable: true,
  });
  assert.equal(isEdge(), true);
  if (origNavDesc !== undefined) {
    Object.defineProperty(globalThis, "navigator", origNavDesc);
  } else {
    // @ts-expect-error cleanup
    delete globalThis.navigator;
  }

  // Test Cloudflare Workers WebSocketPair
  (globalThis as any).WebSocketPair = function () {};
  assert.equal(isEdge(), true);
  delete (globalThis as any).WebSocketPair;

  // Test env vars
  const origNext = process.env["NEXT_RUNTIME"];
  process.env["NEXT_RUNTIME"] = "edge";
  assert.equal(isEdge(), true);
  if (origNext !== undefined) process.env["NEXT_RUNTIME"] = origNext;
  else delete process.env["NEXT_RUNTIME"];

  const origEdge = process.env["EDGE_RUNTIME"];
  process.env["EDGE_RUNTIME"] = "true";
  assert.equal(isEdge(), true);
  if (origEdge !== undefined) process.env["EDGE_RUNTIME"] = origEdge;
  else delete process.env["EDGE_RUNTIME"];

  const origVolten = process.env["VOLTEN_RUNTIME"];
  process.env["VOLTEN_RUNTIME"] = "edge";
  assert.equal(isEdge(), true);
  if (origVolten !== undefined) process.env["VOLTEN_RUNTIME"] = origVolten;
  else delete process.env["VOLTEN_RUNTIME"];

  const origNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "edge";
  assert.equal(isEdge(), true);
  if (origNodeEnv !== undefined) process.env["NODE_ENV"] = origNodeEnv;
  else delete process.env["NODE_ENV"];
});

test("Edge runtime: compose.ts uses slow path createDynamicMiddlewareChain in edge", async () => {
  setIsEdge(true);
  try {
    const executed: string[] = [];
    const chain = [
      async (ctx: RequestContext, next: () => Promise<void> | void) => {
        executed.push("m1-before");
        await next();
        executed.push("m1-after");
      },
      async (_ctx: RequestContext, next: () => Promise<void> | void) => {
        executed.push("m2-before");
        await next();
        executed.push("m2-after");
      },
      (ctx: RequestContext) => {
        executed.push("handler");
        ctx.send("done");
      },
    ];

    const chainHandler = compileMiddlewareChain(chain);
    const mockCtx = {
      sent: false,
      _app: null,
      send(_val: unknown) {
        this.sent = true;
      },
    } as unknown as RequestContext;

    await chainHandler(mockCtx);
    assert.deepEqual(executed, ["m1-before", "m2-before", "handler", "m2-after", "m1-after"]);

    // Test empty chain
    const emptyHandler = compileMiddlewareChain([]);
    await emptyHandler(mockCtx);

    // Test double next call error in dynamic chain
    const brokenChain = [
      async (_ctx: RequestContext, next: () => Promise<void> | void) => {
        await next();
        await next(); // should throw
      },
      (ctx: RequestContext) => {
        ctx.send("ok");
      },
    ];

    const brokenHandler = createDynamicMiddlewareChain(brokenChain);
    let errorCaught: unknown = null;
    const mockCtx2 = {
      sent: false,
      _app: {
        handleError(err: unknown) {
          errorCaught = err;
        },
      },
      send() {
        this.sent = true;
      },
    } as unknown as RequestContext;

    await brokenHandler(mockCtx2);
    assert.ok(errorCaught instanceof InvalidNextCallError);
  } finally {
    setIsEdge(null);
  }
});

test("Edge runtime: stringifyJson.ts uses slow path JSON.stringify in edge", () => {
  setIsEdge(true);
  try {
    const sample = { id: 1, name: "test", nested: { a: "b" } };
    const serializer = compileVoltJson(sample);
    assert.equal(serializer(sample), JSON.stringify(sample));

    const jsonResult = voltJson(sample);
    assert.equal(jsonResult, JSON.stringify(sample));
  } finally {
    setIsEdge(null);
  }
});

test("Edge runtime: routeTree.ts uses uncompiled radix tree traversal slow path in edge", () => {
  setIsEdge(true);
  try {
    const tree = new RouteTree(false);
    const handler = () => {};
    const defaultOptions = {
      bodyLimit: 1048576,
      priority: "normal" as const,
    };

    tree.addPath("GET", "/users/:id", [handler], defaultOptions);
    tree.addPath("POST", "/files/*", [handler], defaultOptions);
    tree.addPath("GET", "/static/route", [handler], defaultOptions);

    // createMatchPath should be a no-op in Edge
    tree.createMatchPath();

    const dummyCtx = {
      inited: true,
      params: {},
    } as unknown as RequestContext;

    const matchStatic = tree.matchPath("GET", "/static/route", dummyCtx);
    assert.ok(matchStatic !== null);

    const matchParam = tree.matchPath("GET", "/users/42", dummyCtx);
    assert.ok(matchParam !== null);
    assert.equal((dummyCtx.params as Record<string, string>)["id"], "42");

    const dummyWildcardCtx = {
      inited: true,
      params: {},
    } as unknown as RequestContext;

    const matchWildcard = tree.matchPath("POST", "/files/docs/readme.txt", dummyWildcardCtx);
    assert.ok(matchWildcard !== null);
    assert.equal((dummyWildcardCtx.params as Record<string, string>)["*"], "docs/readme.txt");
  } finally {
    setIsEdge(null);
  }
});

test("Edge runtime: full app with createFetch executes smoothly in Edge mode", async () => {
  setIsEdge(true);
  try {
    const app = new App();

    app.use(async (ctx, next) => {
      ctx.setHeader("X-Custom-Middleware", "active");
      await next();
    });

    app.get("/api/user/:name", (ctx) => {
      ctx.json({
        user: ctx.params["name"],
        edge: true,
      });
    });

    const fetchHandler = app.createFetch();
    const res = await fetchHandler(new Request("https://example.com/api/user/alice"));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-custom-middleware"), "active");
    assert.deepEqual(await res.json(), { user: "alice", edge: true });
  } finally {
    setIsEdge(null);
  }
});

test("Edge runtime: graceful fallback when Function eval is blocked/throws EvalError", async () => {
  // Mock Function constructor to throw EvalError (simulating strict CSP / edge sandboxes)
  const originalFunction = globalThis.Function;
  const blockedFunction = function (..._args: string[]) {
    throw new EvalError("Code generation from strings disallowed for this context");
  };
  blockedFunction.prototype = originalFunction.prototype;
  // @ts-expect-error Mocking Function constructor for test
  globalThis.Function = blockedFunction;

  try {
    // 1. compose fallback
    const chainHandler = compileMiddlewareChain([(ctx) => ctx.send("blocked-ok")]);
    const mockCtx = {
      sent: false,
      _app: null,
      send() {
        this.sent = true;
      },
    } as unknown as RequestContext;
    await chainHandler(mockCtx);
    assert.equal(mockCtx.sent, true);

    // 2. stringifyJson fallback
    const serializer = compileVoltJson({ a: 1 });
    assert.equal(serializer({ a: 1 }), JSON.stringify({ a: 1 }));

    // 3. routeTree fallback
    const tree = new RouteTree(false);
    tree.addPath("GET", "/test/:param", [() => {}], {
      bodyLimit: 1048576,
      priority: "normal",
    });
    // createMatchPath should catch the EvalError safely
    tree.createMatchPath();

    const ctx = { inited: true, params: {} } as unknown as RequestContext;
    const match = tree.matchPath("GET", "/test/hello", ctx);
    assert.ok(match !== null);
    assert.equal((ctx.params as Record<string, string>)["param"], "hello");
  } finally {
    globalThis.Function = originalFunction;
    setIsEdge(null);
  }
});
