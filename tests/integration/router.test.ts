import { test } from "node:test";
import assert from "node:assert";
import { App } from "../../src/core/server.ts";
import { Router } from "../../src/core/router.ts";
import { requestFetch } from "../helpers.ts";

test("Router tests", async (t) => {
  await t.test("should register a basic route on a router", async () => {
    const app = new App();
    const router = new Router();

    router.get("/hello", (ctx) => {
      ctx.send("Hello from router");
    });

    app.use("/api", router);

    const response = await requestFetch(app, "/api/hello");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, "Hello from router");
  });

  await t.test("should support middleware on router", async () => {
    const app = new App();
    const router = new Router();

    router.use((ctx, next) => {
      ctx.res.setHeader("X-Router-Middleware", "true");
      return next();
    });

    router.get("/data", (ctx) => {
      ctx.send("Router data");
    });

    app.use("/api", router);

    const response = await requestFetch(app, "/api/data");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("x-router-middleware"), "true");
    assert.strictEqual(response.body, "Router data");
  });

  await t.test("should support app-level middleware combined with router routes", async () => {
    const app = new App();
    const router = new Router();

    app.use((ctx, next) => {
      ctx.res.setHeader("X-App-Middleware", "true");
      return next();
    });

    router.get("/info", (ctx) => {
      ctx.send("Info");
    });

    app.use("/api", router);

    const response = await requestFetch(app, "/api/info");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("x-app-middleware"), "true");
  });

  await t.test("should support nested routers", async () => {
    const app = new App();
    const parentRouter = new Router();
    const childRouter = new Router();

    childRouter.get("/profile", (ctx) => {
      ctx.send("User profile");
    });

    parentRouter.use("/users", childRouter);
    app.use("/api", parentRouter);

    const response = await requestFetch(app, "/api/users/profile");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, "User profile");
  });

  await t.test("should support mounting router without a prefix", async () => {
    const app = new App();
    const router = new Router();

    router.get("/ping", (ctx) => {
      ctx.send("pong");
    });

    app.use(router);

    const response = await requestFetch(app, "/ping");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, "pong");
  });

  await t.test("should not shadow parameters on route path sharing", async () => {
    const app = new App();
    app.get("/users/:id", (ctx) => {
      ctx.json({ id: ctx.params.id });
    });
    app.get("/users/:username/profile", (ctx) => {
      ctx.json({ username: ctx.params.username });
    });

    const res1 = await requestFetch(app, "/users/123");
    const json1 = JSON.parse(res1.body);
    assert.strictEqual(json1.id, "123");

    const res2 = await requestFetch(app, "/users/john/profile");
    const json2 = JSON.parse(res2.body);
    assert.strictEqual(json2.username, "john");
  });
});
