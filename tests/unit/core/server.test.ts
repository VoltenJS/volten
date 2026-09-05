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

test("App logger: default logger works and logs warn level by default", () => {
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

test("App logger: configLogger configures new custom levels and changes settings", () => {
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

test("App: getRoute and getRouteTree return route metadata and tree instance", () => {
  const app = new App();
  app.get("/hello", (ctx) => ctx.send("hi"));
  (app as any).register(app);

  const tree = app.getRouteTree();
  assert.ok(tree !== null);

  const dummyCtx = { inited: false, params: {} } as any;
  const route = app.getRoute("GET", "/hello", dummyCtx);
  assert.ok(route !== null);
});

test("App: resetCtx and resetEdgeCtx ignore uninitialized context", () => {
  const app = new App();
  const nodeCtx = new NodeRequestContext();
  const edgeCtx = new EdgeRequestContext();

  // inited is false, reset calls should return safely without pushing to pool
  app.resetCtx(nodeCtx);
  app.resetEdgeCtx(edgeCtx);
});
