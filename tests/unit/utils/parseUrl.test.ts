import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, parseUrl } from "../../../src/utils/parseUrl.ts";

// =====================================================================
// Unit tests for parseUrl + parseQuery (src/utils/parseurl.ts)
// Covers protocol-relative + absolute-URL branches and the query parser.
// =====================================================================

test("ParseUrl Unit Tests", async (t) => {
  await t.test("bare pathname", () => {
    assert.deepEqual(parseUrl("/foo/bar"), {
      pathname: "/foo/bar",
      queryStr: "",
    });
  });

  await t.test("pathname with query string", () => {
    const r = parseUrl("/foo?x=1&y=2");
    assert.equal(r.pathname, "/foo");
    assert.equal(r.queryStr, "x=1&y=2");
  });

  await t.test("http:// scheme with host", () => {
    const r = parseUrl("http://example.com/api/v1?token=abc");
    assert.equal(r.pathname, "/api/v1");
    assert.equal(r.queryStr, "token=abc");
  });

  await t.test("https:// scheme with host", () => {
    const r = parseUrl("https://example.com/secure/path?x=1");
    assert.equal(r.pathname, "/secure/path");
    assert.equal(r.queryStr, "x=1");
  });

  await t.test("// protocol-relative URL", () => {
    const r = parseUrl("//cdn.example.com/asset.js?v=2");
    assert.equal(r.pathname, "/asset.js");
    assert.equal(r.queryStr, "v=2");
  });

  await t.test("http:// with no path returns '/' and empty query", () => {
    // Covers the pathStart === -1 branch in parseurl.ts (line 17).
    const r = parseUrl("http://example.com");
    assert.deepEqual(r, { pathname: "/", queryStr: "" });
  });

  await t.test("trailing slash on the path is stripped", () => {
    // The implementation only strips when length > 1
    assert.deepEqual(parseUrl("/foo/"), { pathname: "/foo", queryStr: "" });
  });

  await t.test("root path returns '/'", () => {
    assert.deepEqual(parseUrl("/"), { pathname: "/", queryStr: "" });
  });

  await t.test("empty path returns '/'", () => {
    assert.deepEqual(parseUrl(""), { pathname: "/", queryStr: "" });
  });

  await t.test("only query string returns '/'", () => {
    assert.deepEqual(parseUrl("?x=1"), { pathname: "/", queryStr: "x=1" });
  });

  await t.test("empty string returns empty object", () => {
    assert.deepEqual(parseQuery(""), {});
  });

  await t.test("simple key/value", () => {
    assert.deepEqual(parseQuery("a=1"), { a: "1" });
  });

  await t.test("multiple keys", () => {
    assert.deepEqual(parseQuery("a=1&b=2&c=3"), { a: "1", b: "2", c: "3" });
  });

  await t.test("repeated key produces an array", () => {
    assert.deepEqual(parseQuery("a=1&a=2"), { a: ["1", "2"] });
  });

  await t.test("three-time-repeated key", () => {
    assert.deepEqual(parseQuery("a=1&a=2&a=3"), { a: ["1", "2", "3"] });
  });

  await t.test("+ decoded as space", () => {
    assert.deepEqual(parseQuery("q=hello+world"), { q: "hello world" });
  });

  await t.test("URI-decoded values", () => {
    assert.deepEqual(parseQuery("name=John%20Doe"), { name: "John Doe" });
  });

  await t.test("key without = (value defaults to empty string)", () => {
    assert.deepEqual(parseQuery("flag"), { flag: "" });
  });

  await t.test("trailing & and dangling = are tolerated", () => {
    assert.deepEqual(parseQuery("a=1&"), { a: "1" });
    assert.deepEqual(parseQuery("a=1&b="), { a: "1", b: "" });
  });
});
