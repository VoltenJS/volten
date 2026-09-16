import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDevErrorPage, isDevMode } from "../../../src/utils/devErrorPage.ts";

test("devErrorPage", async (t) => {
  await t.test("returns null if not in development mode", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    assert.strictEqual(isDevMode(), false);
    const result = buildDevErrorPage(new Error("Test"));
    assert.strictEqual(result, null);
    process.env["NODE_ENV"] = originalEnv;
  });

  await t.test("returns HTML in development mode", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    assert.strictEqual(isDevMode(), true);
    const err = new Error("Test Error");
    const result = buildDevErrorPage(err);
    assert.ok(result !== null);
    assert.ok(result.includes("Test Error"));
    assert.ok(result.includes("devErrorPage.test.ts"));
    process.env["NODE_ENV"] = originalEnv;
  });

  await t.test("handles error without stack trace properly", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    const err = new Error("No Stack");
    delete err.stack;
    const result = buildDevErrorPage(err);
    assert.ok(result !== null);
    assert.ok(result.includes("No Stack"));
    process.env["NODE_ENV"] = originalEnv;
  });

  await t.test("handles unreadable source file", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    const err = new Error("Unreadable");
    err.stack = "Error: Unreadable\n    at fakeFunction (/fake/unreadable/path.ts:10:5)";
    const result = buildDevErrorPage(err);
    assert.ok(result !== null);
    assert.ok(result.includes("Could not read source file."));
    process.env["NODE_ENV"] = originalEnv;
  });
});
