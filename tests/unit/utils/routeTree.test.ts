import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteTree, MethodStorage, PathNode } from "../../../src/utils/routeTree.ts";
import { RequestContext } from "../../../src/utils/requestCtx.ts";

test("MethodStorage: set and get for all HTTP methods", () => {
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

test("PathNode: constructor initializes prefix and charCode", () => {
  const node1 = new PathNode("test");
  assert.equal(node1.prefix, "test");
  assert.equal(node1.charCode, "t".charCodeAt(0));

  const node2 = new PathNode("");
  assert.equal(node2.charCode, -1);
});

test("RouteTree: addPath, checkDuplicate, checkMethodAllowed, getRoutePriority, setDeOpt", () => {
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

test("RouteTree: splits static child nodes with multiple siblings", () => {
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
