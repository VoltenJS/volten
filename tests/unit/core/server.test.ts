import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../../src/core/server.ts";
import { NodeRequestContext, EdgeRequestContext } from "../../../src/utils/requestCtx.ts";

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
