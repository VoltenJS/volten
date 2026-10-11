import { test } from "node:test";
import assert from "node:assert/strict";
import { JitCache } from "../../../src/utils/jitCache.ts";

// =====================================================================
// Unit tests for JitCache (src/utils/jitcache.ts)
// Covers all happy paths and all "fingerprint not found" throw branches.
// =====================================================================

test("JitCache Unit Tests", async (t) => {
  await t.test("getCount throws when the fingerprint does not exist", () => {
    const cache = new JitCache();
    assert.throws(() => cache.getCount(42), /Fingerprint does not exist/);
  });

  await t.test("setCompiler throws when the fingerprint is missing", () => {
    const cache = new JitCache();
    assert.throws(
      () => cache.setCompiler(99, () => ""), // return string
      /Attempting to set a compiler for a fingerprint that doesn't exist/,
    );
  });

  await t.test("addCount throws when the fingerprint is missing", () => {
    const cache = new JitCache();
    assert.throws(
      () => cache.addCount(123),
      /Attempting to add count for a fingerprint that doesn't exist/,
    );
  });

  await t.test("resetCount throws when the fingerprint is missing", () => {
    const cache = new JitCache();
    assert.throws(
      () => cache.resetCount(456),
      /Attempting to reset count for a fingerprint that doesn't exist/,
    );
  });

  await t.test("delete throws when the fingerprint is missing", () => {
    const cache = new JitCache();
    assert.throws(() => cache.delete(789), /Attempting to delete a fingerprint that doesn't exist/);
  });

  await t.test("create evicts the oldest entry when max size is reached", () => {
    const cache = new JitCache(2);
    cache.create(1);
    cache.create(2);
    cache.create(3); // should evict 1
    // 1 was evicted, so getCount(1) throws
    assert.throws(() => cache.getCount(1), /Fingerprint does not exist/);
    assert.equal(cache.getCount(2), 0);
    assert.equal(cache.getCount(3), 0);
  });

  await t.test("getCompiler refreshes LRU order", () => {
    const cache = new JitCache(2);
    cache.create(1);
    cache.create(2);
    const compiler = (_d: unknown, _ctx: unknown) => {};
    cache.setCompiler(1, compiler as any);

    // Touch 1, then add 3 → 2 should be evicted, 1 should remain
    assert.equal(cache.getCompiler(1), compiler);
    cache.create(3);

    // 1 still cached
    assert.equal(cache.getCompiler(1), compiler);
    // 2 was evicted
    assert.throws(() => cache.getCount(2), /Fingerprint does not exist/);
    assert.equal(cache.getCount(3), 0);
  });

  await t.test("getShapeFingerprint covers all data types and caching", () => {
    const cache = new JitCache();

    // Primitives and objects
    const obj = {
      n: 123,
      s: "hello",
      b: true,
      u: undefined,
      nil: null,
      fn: () => {},
      big: BigInt(9007199254740991),
      sym: Symbol("test"),
      d: new Date(),
      arr: [1, 2, 3],
    };

    const fp1 = cache.getShapeFingerprint(obj);
    assert.ok(typeof fp1 === "number" && fp1 > 0);

    // Calling again returns cached fingerprint WeakMap
    const fp2 = cache.getShapeFingerprint(obj);
    assert.equal(fp1, fp2);

    // Deep object with > 32 keys to trigger stack growth
    const largeObj: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      largeObj[`key_${i}`] = { nested: i };
    }
    const fpLarge = cache.getShapeFingerprint(largeObj);
    assert.ok(typeof fpLarge === "number");

    // Null object
    const fpNull = cache.getShapeFingerprint(null);
    assert.ok(typeof fpNull === "number");
  });

  await t.test("set and get operations with existing and non-existing fingerprints", () => {
    const cache = new JitCache(5);
    assert.equal(cache.get(999), undefined);

    const fn1 = () => "fn1";
    // set on non-existing fingerprint creates it
    cache.set(100, fn1 as any);
    assert.equal(cache.get(100), fn1);

    // set on existing fingerprint updates it
    const fn2 = () => "fn2";
    cache.set(100, fn2 as any);
    assert.equal(cache.get(100), fn2);

    // addCount and resetCount on existing fingerprint
    assert.equal(cache.getCount(100), 0);
    cache.addCount(100);
    assert.equal(cache.getCount(100), 1);
    cache.resetCount(100);
    assert.equal(cache.getCount(100), 0);

    // delete
    cache.delete(100);
    assert.throws(() => cache.getCount(100), /Fingerprint does not exist/);
  });
});
