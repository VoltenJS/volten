import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../../src/core/server.ts";

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
    { mockCtx: true }
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
    headers: { Cookie: "session=xyz" }
  });
  const res = await fetchHandler(req);
  assert.equal(res.status, 200);
  
  // Web Headers object returns comma-separated or multiple Set-Cookie headers
  // Headers.get() normally combines them or gets the first, but let's check
  const setCookie = res.headers.get("Set-Cookie");
  assert.ok(setCookie?.includes("cookie1=val1"));
  assert.ok(setCookie?.includes("cookie2=val2"));
});
