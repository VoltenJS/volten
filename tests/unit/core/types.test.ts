import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../../src/core/server.ts";
import type { ExtractParams } from "../../../src/core/types.ts";

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

test("TS Type Param Extraction: resolves correct types", () => {
  const t1: Equals<ExtractParams<"/users">, Record<string, never>> = true;
  assert.ok(t1);

  const t2: Equals<ExtractParams<"/users/:id">, { id: string }> = true;
  assert.ok(t2);

  const t3: Equals<
    ExtractParams<"/users/:id/posts/:postId">,
    { id: string; postId: string }
  > = true;
  assert.ok(t3);

  const t4: Equals<ExtractParams<"/files/*">, { "*": string }> = true;
  assert.ok(t4);
});

test("Router path parameter TS type inference compiles", () => {
  const app = new App();
  app.get("/user/:id/posts/:postId", (ctx) => {
    const id: string = ctx.params.id;
    const postId: string = ctx.params.postId;

    assert.equal(typeof id, "undefined"); // in this mock test context it's undefined
    assert.equal(typeof postId, "undefined");
  });
});
