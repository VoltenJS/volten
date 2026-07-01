import { test } from "node:test";
import assert from "node:assert/strict";
import { JitCache } from "../../../src/utils/jitcache.ts";

// =====================================================================
// Unit tests for JitCache (src/utils/jitcache.ts)
// Covers all happy paths and all "fingerprint not found" throw branches.
// =====================================================================

test("JitCache: getCount throws when the fingerprint does not exist", () => {
  const cache = new JitCache();
  assert.throws(
    () => cache.getCount(42),
    /Fingerprint does not exist/,
  );
});

test("JitCache: setCompiler throws when the fingerprint is missing", () => {
  const cache = new JitCache();
  assert.throws(
    () => cache.setCompiler(99, () => {}),
    /Attempting to set a compiler for a fingerprint that doesn't exist/,
  );
});

test("JitCache: addCount throws when the fingerprint is missing", () => {
  const cache = new JitCache();
  assert.throws(
    () => cache.addCount(123),
    /Attempting to add count for a fingerprint that doesn't exist/,
  );
});

test("JitCache: resetCount throws when the fingerprint is missing", () => {
  const cache = new JitCache();
  assert.throws(
    () => cache.resetCount(456),
    /Attempting to reset count for a fingerprint that doesn't exist/,
  );
});

test("JitCache: delete throws when the fingerprint is missing", () => {
  const cache = new JitCache();
  assert.throws(
    () => cache.delete(789),
    /Attempting to delete a fingerprint that doesn't exist/,
  );
});

test("JitCache: create evicts the oldest entry when max size is reached", () => {
  const cache = new JitCache(2);
  cache.create(1);
  cache.create(2);
  cache.create(3); // should evict 1
  // 1 was evicted, so getCount(1) throws
  assert.throws(() => cache.getCount(1), /Fingerprint does not exist/);
  assert.equal(cache.getCount(2), 0);
  assert.equal(cache.getCount(3), 0);
});

test("JitCache: getCompiler refreshes LRU order", () => {
  const cache = new JitCache(2);
  cache.create(1);
  cache.create(2);
  const compiler = (d: unknown, ctx: unknown) => {};
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
