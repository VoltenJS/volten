import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../../src/core/server.ts";
import { Router } from "../../../src/core/router.ts";
import { NodeRequestContext, EdgeRequestContext } from "../../../src/utils/requestCtx.ts";
import { request } from "../../helpers.ts";

function captureLogs(fn: () => void): any[] {
  const originalInfo = console.info;
  const logs: any[] = [];
  console.info = (output: any) => {
    try {
      logs.push(JSON.parse(output));
    } catch {
      // ignore
    }
  };
  try {
    fn();
  } finally {
    console.info = originalInfo;
  }
  return logs;
}

test("inspectRoute exposes immutable metadata and compiles mounted sub-router routes", () => {
  const app = new App({ RequestPoolSize: 1 });
  const api = new Router();
  api.get("/users", (ctx) => ctx.send("users"));
  app.use("/api", api);

  const info = app.inspectRoute("GET", "/api/users");

  assert.ok(info);
  assert.equal(info.level, "OPTIMIZED");
  assert.equal(info.effectiveHandlerCount, 1);
  assert.equal(info.path, "/api/users");
  assert.equal(Object.isFrozen(info), true);
  assert.equal("chain" in info, false);
  assert.equal("executeNode" in info, false);
  assert.equal("terminalHandler" in info, false);
});

test("inspectRoute reflects routes added after an earlier route-tree compilation", () => {
  const app = new App({ RequestPoolSize: 1 });
  app.get("/first", (ctx) => ctx.send("first"));
  assert.ok(app.inspectRoute("GET", "/first"));

  app.get("/second", (ctx) => ctx.send("second"));
  assert.ok(app.inspectRoute("GET", "/second"));
});

test("Server Unit Tests", async (t) => {
  await t.test("default logger works and logs warn level by default", () => {
    const app = new App();

    const logs = captureLogs(() => {
      app.logger.info("should not log");
      app.logger.warn("this is a warning");
      app.logger.error("this is an error");
      app.logger.fatal("this is fatal");
    });

    assert.equal(logs.length, 3);
    assert.equal(logs[0].level, "warn");
    assert.equal(logs[0].msg, "this is a warning");
    assert.equal(logs[1].level, "error");
    assert.equal(logs[1].msg, "this is an error");
    assert.equal(logs[2].level, "fatal");
    assert.equal(logs[2].msg, "this is fatal");
  });

  await t.test("configLogger configures new custom levels and changes settings", () => {
    const app = new App();

    const customLogger = app.configLogger<"test1" | "test2">({
      customLevels: {
        test1: 25,
        test2: 35,
      },
      level: "test1",
      baseContext: {
        env: "production",
        service: "user-service",
      },
    });

    const logs = captureLogs(() => {
      customLogger.test1("Hello test1");
      customLogger.test2("Hello test2");
      customLogger.info("Hello info");
      customLogger.debug("Should not log debug");
    });

    assert.equal(logs.length, 3);
    assert.equal(logs[0].level, "test1");
    assert.equal(logs[0].msg, "Hello test1");
    assert.equal(logs[0].env, "production");
    assert.equal(logs[0].service, "user-service");

    assert.equal(logs[1].level, "test2");
    assert.equal(logs[1].msg, "Hello test2");

    assert.equal(logs[2].level, "info");
    assert.equal(logs[2].msg, "Hello info");
  });

  await t.test("getRoute and getRouteTree return route metadata and tree instance", () => {
    const app = new App();
    app.get("/hello", (ctx) => ctx.send("hi"));
    (app as any).register(app);

    const tree = app.getRouteTree();
    assert.ok(tree !== null);

    const dummyCtx = { inited: false, params: {} } as any;
    const route = app.getRoute("GET", "/hello", dummyCtx);
    assert.ok(route !== null);
  });

  await t.test("resetCtx and resetEdgeCtx ignore uninitialized context", () => {
    const app = new App();
    const nodeCtx = new NodeRequestContext();
    const edgeCtx = new EdgeRequestContext();

    // inited is false, reset calls should return safely without pushing to pool
    app.resetCtx(nodeCtx);
    app.resetEdgeCtx(edgeCtx);
  });

  await t.test("app.fetch processes edge requests correctly", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    app.get("/api/test", (ctx) => {
      ctx.json({ ok: true });
    });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/api/test");
    const res = await fetch(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  });

  await t.test("app.fetch triggers edge 404 correctly", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/not-found");
    const res = await fetch(req);
    assert.strictEqual(res.status, 404);
  });

  await t.test("app.fetch edge generic error handling", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    app.get("/crash", () => {
      throw new Error("Edge Crash");
    });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/crash");
    const res = await fetch(req);
    assert.strictEqual(res.status, 500);
  });

  await t.test("app.fetch handles preflight requests", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    app.preflight((ctx) => {
      ctx.setHeader("Access-Control-Allow-Methods", "GET, POST");
      ctx.status(204).send();
    });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/test", { method: "OPTIONS" });
    const res = await fetch(req);
    assert.strictEqual(res.status, 204);
  });

  // Internal branch test: compilePreflightHandler() always wraps preflight hooks in an
  // async function, so through the ordinary public API `preflightResult` in handleRequest()
  // is always Thenable and hits the `.then(() => { if (!ctx.sent) this.executeRouting(ctx); })`
  // branch (line 458). The synchronous `if (ctx.sent) return;` guard at line 468 is defensive
  // code for an internal/future synchronous preflight fast-path where `preflightHandler` is
  // assigned a non-async function directly. This test explicitly exercises that internal
  // defensive branch and is NOT public-API verification.
  await t.test(
    "[internal sync branch] defensive if (ctx.sent) return guard stops Node HTTP routing when preflightHandler returns non-Thenable",
    async () => {
      const app = new App({ loggerOptions: { level: "fatal" } });
      let preflightExecuted = false;
      let downstreamRouteExecuted = false;

      const syncPreflightHook = (ctx: any) => {
        preflightExecuted = true;
        ctx.setHeader("X-Preflight-Short-Circuit", "true");
        ctx.status(401).send("Halted by preflight");
      };

      app.preflight(syncPreflightHook);
      const origCompile = (app as any).compilePreflightHandler.bind(app);
      (app as any).compilePreflightHandler = () => {
        origCompile();
        (app as any).preflightHandler = syncPreflightHook;
      };

      app.get("/protected", (ctx) => {
        downstreamRouteExecuted = true;
        ctx.status(200).json({ ok: true });
      });

      const res = await request(app, "/protected", { method: "GET" });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.headers["x-preflight-short-circuit"], "true");
      assert.strictEqual(res.body, "Halted by preflight");
      assert.strictEqual(preflightExecuted, true);
      assert.strictEqual(
        downstreamRouteExecuted,
        false,
        "Downstream route handler must not execute after synchronous preflight hook sends response",
      );
    },
  );

  await t.test(
    "public API: app.preflight() synchronous hook that sends a response short-circuits routing via listen()",
    async () => {
      const app = new App({ loggerOptions: { level: "fatal" } });
      let preflightExecuted = false;
      let middlewareExecuted = false;
      let downstreamRouteExecuted = false;

      app.preflight((ctx) => {
        preflightExecuted = true;
        ctx.setHeader("X-Public-Preflight", "blocked");
        ctx.status(403).send("Forbidden by preflight");
      });

      app.use(async (_ctx, next) => {
        middlewareExecuted = true;
        await next();
      });

      app.get("/resource", (ctx) => {
        downstreamRouteExecuted = true;
        ctx.status(200).json({ ok: true });
      });

      const res = await request(app, "/resource", { method: "GET" });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.headers["x-public-preflight"], "blocked");
      assert.strictEqual(res.body, "Forbidden by preflight");
      assert.strictEqual(preflightExecuted, true);
      assert.strictEqual(middlewareExecuted, false);
      assert.strictEqual(downstreamRouteExecuted, false);
    },
  );

  await t.test(
    "public API: app.preflight() synchronous hook that does not send a response continues to normal routing via listen()",
    async () => {
      const app = new App({ loggerOptions: { level: "fatal" } });
      const executionOrder: string[] = [];

      app.preflight((ctx) => {
        executionOrder.push("preflight");
        ctx.setHeader("X-Preflight-Trace", "passed");
      });

      app.use(async (_ctx, next) => {
        executionOrder.push("middleware");
        await next();
      });

      app.get("/resource", (ctx) => {
        executionOrder.push("route");
        ctx.status(200).send("OK");
      });

      const res = await request(app, "/resource", { method: "GET" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["x-preflight-trace"], "passed");
      assert.strictEqual(res.body, "OK");
      assert.deepStrictEqual(executionOrder, ["preflight", "middleware", "route"]);
    },
  );

  await t.test(
    "public API: app.preflight() async hooks support both short-circuiting and pass-through via listen()",
    async () => {
      const app = new App({ loggerOptions: { level: "fatal" } });
      let routeCalls = 0;

      app.preflight(async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ctx.setHeader("X-Async-Preflight-1", "ran");
        if (ctx.headers["x-halt"] === "1") {
          ctx.status(429).send("Rate limited in async preflight");
        }
      });

      app.preflight(async (ctx) => {
        await Promise.resolve();
        ctx.setHeader("X-Async-Preflight-2", "ran");
      });

      app.get("/items", (ctx) => {
        routeCalls += 1;
        ctx.status(200).send("items-list");
      });

      const blockedRes = await request(app, "/items", {
        method: "GET",
        headers: { "x-halt": "1" },
      });
      assert.strictEqual(blockedRes.status, 429);
      assert.strictEqual(blockedRes.headers["x-async-preflight-1"], "ran");
      assert.strictEqual(blockedRes.headers["x-async-preflight-2"], undefined);
      assert.strictEqual(blockedRes.body, "Rate limited in async preflight");
      assert.strictEqual(routeCalls, 0);

      const allowedRes = await request(app, "/items", { method: "GET" });
      assert.strictEqual(allowedRes.status, 200);
      assert.strictEqual(allowedRes.headers["x-async-preflight-1"], "ran");
      assert.strictEqual(allowedRes.headers["x-async-preflight-2"], "ran");
      assert.strictEqual(allowedRes.body, "items-list");
      assert.strictEqual(routeCalls, 1);
    },
  );

  await t.test(
    "public API: app.preflight() synchronous and asynchronous errors route to onError without running route handlers",
    async () => {
      const app = new App({ loggerOptions: { level: "fatal" } });
      let routeExecuted = false;
      const caughtErrors: string[] = [];

      app.preflight((ctx) => {
        if (ctx.headers["x-fail-mode"] === "sync") {
          throw new Error("Preflight sync boom");
        }
      });

      app.preflight(async (ctx) => {
        if (ctx.headers["x-fail-mode"] === "async") {
          await Promise.resolve();
          throw new Error("Preflight async boom");
        }
      });

      app.onError((err, ctx) => {
        caughtErrors.push(err.message);
        ctx.status(500).send(`Caught: ${err.message}`);
      });

      app.get("/check", (ctx) => {
        routeExecuted = true;
        ctx.status(200).send("ok");
      });

      const syncErrRes = await request(app, "/check", {
        method: "GET",
        headers: { "x-fail-mode": "sync" },
      });
      assert.strictEqual(syncErrRes.status, 500);
      assert.strictEqual(syncErrRes.body, "Caught: Preflight sync boom");
      assert.strictEqual(routeExecuted, false);

      const asyncErrRes = await request(app, "/check", {
        method: "GET",
        headers: { "x-fail-mode": "async" },
      });
      assert.strictEqual(asyncErrRes.status, 500);
      assert.strictEqual(asyncErrRes.body, "Caught: Preflight async boom");
      assert.strictEqual(routeExecuted, false);
      assert.deepStrictEqual(caughtErrors, ["Preflight sync boom", "Preflight async boom"]);
    },
  );

  await t.test("executeFallback catches crashes in custom errorHandler (Node)", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    app.logger.level = "fatal"; // hide the error output for cleaner tests
    app.onError(() => {
      throw new Error("Fatal Error Handler Crash");
    });
    (app as any).register(app);

    const req = { method: "GET", url: "/" } as any;
    let destroyed = false;
    const res = {
      destroy: () => {
        destroyed = true;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    await app.handleError(new Error("initial error"), ctx);
    assert.strictEqual(destroyed, true);
  });

  await t.test("executeFallback catches crashes in custom errorHandler (Edge)", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    app.onError(() => {
      throw new Error("Fatal Error Handler Crash");
    });
    app.get("/", () => {
      throw new Error("Trigger crash");
    });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/");

    const response = await fetch(req);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(await response.text(), "Internal Server Error");
  });

  await t.test("executeFallback catches crashes in core errorHandler (Node)", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    (app as any).errorHandler = () => {
      throw new Error("Fatal Error Handler Crash");
    };
    (app as any).register(app);

    const req = { method: "GET", url: "/" } as any;
    let destroyed = false;
    const res = {
      destroy: () => {
        destroyed = true;
      },
    } as any;

    const ctx = new NodeRequestContext();
    ctx.init(app, req, res);

    await app.handleError(new Error("initial error"), ctx);
    assert.strictEqual(destroyed, true);
  });

  await t.test("executeFallback catches crashes in core errorHandler (Edge)", async () => {
    const app = new App({ loggerOptions: { level: "fatal" } });
    (app as any).errorHandler = () => {
      throw new Error("Fatal Error Handler Crash");
    };
    app.get("/", () => {
      throw new Error("Trigger crash");
    });
    const fetch = app.createFetch();
    const req = new Request("http://localhost/");

    const response = await fetch(req);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(await response.text(), "Internal Server Error");
  });
});
