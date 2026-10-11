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

  await t.test(
    "safe JSON serialization prevents arbitrary code execution and preserves semantics",
    () => {
      (globalThis as any).__pwned = false;
      const maliciousKey = "${globalThis.__pwned = true}";
      const payload1 = { [maliciousKey]: 1 };
      const serializer = compileVoltJson(payload1);
      const result1 = serializer(payload1);

      assert.equal((globalThis as any).__pwned, false, "Arbitrary JavaScript execution detected!");
      assert.equal(result1, `{"\${globalThis.__pwned = true}":1}`);

      const date = new Date();
      const testObj = {
        quotes: 'He said "Hello"',
        backslashes: "C:\\path\\file",
        newline: "Line1\nLine2",
        tabs: "Col1\tCol2",
        controlCharacters: "A\x00B",
        nan: NaN,
        infinity: Infinity,
        nullVal: null,
        falseVal: false,
        zero: 0,
        empty: "",
        nested: { a: { b: 1 } },
        arrays: [1, 2, [3, 4]],
        date: date,
        toJSON: { toJSON: () => "custom" },
        undefinedVal: undefined,
      };

      const expected = JSON.stringify(testObj);
      const result2 = voltJson(testObj);
      assert.equal(result2, expected, "voltJson must perfectly match JSON.stringify");

      const shape1 = { user: "alice" };
      const shape2 = { user: "bob", age: 24 };
      const shape3 = { age: 24 };

      const s = compileVoltJson(shape1);
      assert.equal(s(shape1), JSON.stringify(shape1));
      assert.equal(s(shape2), JSON.stringify(shape2));
      assert.equal(s(shape3), JSON.stringify(shape3));

      const bigIntObj = { b: 9007199254740991n };
      let throws = false;
      try {
        s(bigIntObj);
      } catch {
        throws = true;
      }
      let nativeThrows = false;
      try {
        JSON.stringify(bigIntObj);
      } catch {
        nativeThrows = true;
      }
      assert.equal(throws, nativeThrows, "BigInt handling must match native behavior");
    },
  );
});
