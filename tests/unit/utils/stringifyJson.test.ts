import { test } from "node:test";
import assert from "node:assert/strict";
import {
  voltJson,
  compileVoltJson,
  isSimple,
  getShapeFingerprint,
} from "../../../src/utils/stringifyJson.ts";

test("stringifyJson Internals", async (t) => {
  await t.test("compiles object with different keys", () => {
    const obj = {
      str: "hello",
      num: 123,
      bool: true,
      arr: [1, 2, 3],
      nested: {
        x: null,
        y: undefined,
        z: () => {},
        sym: Symbol("test"),
        "invalid-id": "test",
        validId: "test",
      },
      date: new Date("2020-01-01T00:00:00Z"),
    };

    const json1 = voltJson(obj);
    assert.strictEqual(typeof json1, "string");

    const json2 = voltJson(obj);
    assert.strictEqual(json1, json2);

    const fp = getShapeFingerprint(obj);
    assert.strictEqual(typeof fp, "number");
  });

  await t.test("compileVoltJson with complex arrays and objects", () => {
    const obj = {
      arr: [1, 2, { a: "b" }],
      nested: { "has space": true, [Symbol.iterator]: null, fn: () => {} },
    };
    const serializer = compileVoltJson(obj);
    assert.strictEqual(typeof serializer(obj), "string");
  });

  await t.test("isSimple", () => {
    assert.strictEqual(isSimple(null), true);
    assert.strictEqual(isSimple([]), true);
    assert.strictEqual(isSimple([1, 2, 3, 4, 5, 6, 7, 8, 9]), false);
    assert.strictEqual(isSimple({ a: 1 }), true);
    assert.strictEqual(isSimple({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }), false);
    assert.strictEqual(isSimple({ a: {} }), false);
  });
});
