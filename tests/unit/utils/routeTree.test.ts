import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteTree, MethodStorage, PathNode } from "../../../src/utils/routeTree.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

test("RouteTree Unit Tests", async (t) => {
  await t.test("set and get for all HTTP methods", () => {
    const ms = new MethodStorage();
    const dummyData: any = { method: "GET" };

    ms.set("GET", dummyData);
    assert.equal(ms.get("GET"), dummyData);

    ms.set("POST", { method: "POST" } as any);
    assert.equal(ms.get("POST")?.method, "POST");

    ms.set("PUT", { method: "PUT" } as any);
    assert.equal(ms.get("PUT")?.method, "PUT");

    ms.set("PATCH", { method: "PATCH" } as any);
    assert.equal(ms.get("PATCH")?.method, "PATCH");

    ms.set("DELETE", { method: "DELETE" } as any);
    assert.equal(ms.get("DELETE")?.method, "DELETE");

    assert.equal(ms.get("OPTIONS"), null);
  });

  await t.test("constructor initializes prefix and charCode", () => {
    const node1 = new PathNode("test");
    assert.equal(node1.prefix, "test");
    assert.equal(node1.charCode, "t".charCodeAt(0));

    const node2 = new PathNode("");
    assert.equal(node2.charCode, -1);
  });

  await t.test("addPath, checkDuplicate, checkMethodAllowed, getRoutePriority, setDeOpt", () => {
    const tree = new RouteTree(false);
    const dummyHandler = () => {};
    const options = { bodyLimit: 1024, priority: "high" as const };

    tree.addPath("GET", "/api/v1/users", [dummyHandler], options);
    tree.addPath("POST", "/api/v1/users", [dummyHandler], options);

    assert.equal(tree.checkDuplicate("GET", "/api/v1/users"), true);
    assert.equal(tree.checkDuplicate("GET", "/api/v1/nonexistent"), false);

    const allowed = tree.checkMethodAllowed("/api/v1/users");
    assert.deepEqual(allowed, ["GET", "POST"]);

    assert.equal(tree.getRoutePriority("GET", "/api/v1/users"), "high");
    assert.equal(tree.getRoutePriority("GET", "/nonexistent"), "normal");

    const dummyCtx = { inited: false, params: {} } as unknown as RequestContext;
    const routeData = tree.matchPath("GET", "/api/v1/users", dummyCtx);
    assert.ok(routeData !== null);

    // Test setDeOpt callback
    routeData.setDeOpt();
    assert.equal(routeData.disableOpt, true);

    // Test clear()
    tree.clear();
    assert.equal(tree.checkDuplicate("GET", "/api/v1/users"), false);
  });

  await t.test("splits static child nodes with multiple siblings", () => {
    const tree = new RouteTree(false);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    // Add multiple routes sharing prefixes to exercise prefix splitting and sibling chains
    tree.addPath("GET", "/api/alpha", [() => {}], options);
    tree.addPath("GET", "/api/beta", [() => {}], options);
    tree.addPath("GET", "/api/gamma", [() => {}], options);

    const dummyCtx = { inited: false, params: {} } as unknown as RequestContext;
    assert.ok(tree.matchPath("GET", "/api/alpha", dummyCtx) !== null);
    assert.ok(tree.matchPath("GET", "/api/beta", dummyCtx) !== null);
    assert.ok(tree.matchPath("GET", "/api/gamma", dummyCtx) !== null);
  });

  await t.test(
    "createMatchPath compiles JIT fast-path and generates monomorphic param shapes",
    () => {
      const tree = new RouteTree(false);
      const options = { bodyLimit: 1024, priority: "normal" as const };

      tree.addPath("GET", "/static/route", [() => {}], options);
      tree.addPath("GET", "/users/:userId/posts/:postId", [() => {}], options);
      tree.addPath("GET", "/files/*", [() => {}], options);

      const ctx = { inited: true, params: {} } as unknown as RequestContext;

      // Trigger JIT compilation via matchPath
      const staticMatch = tree.matchPath("GET", "/static/route", ctx);
      assert.ok(staticMatch !== null);
      assert.equal(staticMatch.method, "GET");

      // Match static route with query string (tests qIdx fallback in compiled code)
      const staticQueryMatch = tree.matchPath("GET", "/static/route?foo=bar", ctx);
      assert.ok(staticQueryMatch !== null);

      // Match dynamic route with parameters and verify monomorphic class instantiation
      ctx.params = {} as any;
      const dynamicMatch = tree.matchPath("GET", "/users/123/posts/456", ctx);
      assert.ok(dynamicMatch !== null);
      assert.equal((ctx.params as any).userId, "123");
      assert.equal((ctx.params as any).postId, "456");

      // Verify constructor name reflects compiled RouteParams shape
      assert.ok(ctx.params.constructor.name.startsWith("RouteParams_"));

      // Match wildcard route
      ctx.params = {} as any;
      const wildcardMatch = tree.matchPath("GET", "/files/docs/readme.md", ctx);
      assert.ok(wildcardMatch !== null);
      assert.equal((ctx.params as any)["*"], "docs/readme.md");
    },
  );

  await t.test("replaces static child on non-first sibling", () => {
    const tree = new RouteTree(false);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    tree.addPath("GET", "/api/first", [() => {}], options);
    tree.addPath("GET", "/api/second-alpha", [() => {}], options);
    tree.addPath("GET", "/api/second-beta", [() => {}], options); // triggers replaceStaticChild on second sibling

    const dummyCtx = { inited: false, params: {} } as unknown as RequestContext;
    assert.ok(tree.matchPath("GET", "/api/second-alpha", dummyCtx) !== null);
    assert.ok(tree.matchPath("GET", "/api/second-beta", dummyCtx) !== null);
  });

  await t.test("throws DuplicateRouteError when adding duplicate route", () => {
    const tree = new RouteTree(false);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    tree.addPath("GET", "/duplicate", [() => {}], options);
    assert.throws(() => {
      tree.addPath("GET", "/duplicate", [() => {}], options);
    });
  });

  await t.test("case-insensitive route matching", () => {
    const tree = new RouteTree(true);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    tree.addPath("GET", "/API/UserS", [() => {}], options);
    const ctx = { inited: true, params: {} } as unknown as RequestContext;

    assert.ok(tree.matchPath("GET", "/api/users", ctx) !== null);
    assert.ok(tree.matchPath("GET", "/API/USERS", ctx) !== null);
  });

  await t.test("overlapping parameter routes resolution", () => {
    const tree = new RouteTree(false);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    tree.addPath("GET", "/org/:orgId/profile", [() => {}], options);
    tree.addPath("GET", "/org/:orgId/settings", [() => {}], options);

    const ctx1 = { inited: true, params: {} } as unknown as RequestContext;
    const m1 = tree.matchPath("GET", "/org/acme/profile", ctx1);
    assert.ok(m1 !== null);
    assert.equal((ctx1.params as any).orgId, "acme");

    const ctx2 = { inited: true, params: {} } as unknown as RequestContext;
    const m2 = tree.matchPath("GET", "/org/globex/settings", ctx2);
    assert.ok(m2 !== null);
    assert.equal((ctx2.params as any).orgId, "globex");
  });

  await t.test("root path and non-matching paths", () => {
    const tree = new RouteTree(false);
    const options = { bodyLimit: 1024, priority: "normal" as const };

    tree.addPath("GET", "/", [() => {}], options);
    const ctx = { inited: true, params: {} } as unknown as RequestContext;

    assert.ok(tree.matchPath("GET", "/", ctx) !== null);
    assert.equal(tree.matchPath("GET", "/nonexistent", ctx), null);
    assert.equal(tree.matchPath("POST", "/", ctx), null);
  });
});
