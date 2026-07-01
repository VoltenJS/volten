import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, parseUrl } from "../../../src/utils/parseurl.ts";

// =====================================================================
// Unit tests for parseUrl + parseQuery (src/utils/parseurl.ts)
// Covers protocol-relative + absolute-URL branches and the query parser.
// =====================================================================

test("parseUrl: bare pathname", () => {
  assert.deepEqual(parseUrl("/foo/bar"), {
    pathname: "/foo/bar",
    queryStr: "",
  });
});

test("parseUrl: pathname with query string", () => {
  const r = parseUrl("/foo?x=1&y=2");
  assert.equal(r.pathname, "/foo");
  assert.equal(r.queryStr, "x=1&y=2");
});

test("parseUrl: http:// scheme with host", () => {
  const r = parseUrl("http://example.com/api/v1?token=abc");
  assert.equal(r.pathname, "/api/v1");
  assert.equal(r.queryStr, "token=abc");
});

test("parseUrl: https:// scheme with host", () => {
  const r = parseUrl("https://example.com/secure/path?x=1");
  assert.equal(r.pathname, "/secure/path");
  assert.equal(r.queryStr, "x=1");
});

test("parseUrl: // protocol-relative URL", () => {
  const r = parseUrl("//cdn.example.com/asset.js?v=2");
  assert.equal(r.pathname, "/asset.js");
  assert.equal(r.queryStr, "v=2");
});

test("parseUrl: http:// with no path returns '/' and empty query", () => {
  // Covers the pathStart === -1 branch in parseurl.ts (line 17).
  const r = parseUrl("http://example.com");
  assert.deepEqual(r, { pathname: "/", queryStr: "" });
});

test("parseUrl: trailing slash on the path is stripped", () => {
  // The implementation only strips when length > 1
  assert.deepEqual(parseUrl("/foo/"), { pathname: "/foo", queryStr: "" });
});

test("parseUrl: root path returns '/'", () => {
  assert.deepEqual(parseUrl("/"), { pathname: "/", queryStr: "" });
});

test("parseUrl: empty path returns '/'", () => {
  assert.deepEqual(parseUrl(""), { pathname: "/", queryStr: "" });
});

test("parseUrl: only query string returns '/'", () => {
  assert.deepEqual(parseUrl("?x=1"), { pathname: "/", queryStr: "x=1" });
});

test("parseQuery: empty string returns empty object", () => {
  assert.deepEqual(parseQuery(""), {});
});

test("parseQuery: simple key/value", () => {
  assert.deepEqual(parseQuery("a=1"), { a: "1" });
});

test("parseQuery: multiple keys", () => {
  assert.deepEqual(parseQuery("a=1&b=2&c=3"), { a: "1", b: "2", c: "3" });
});

test("parseQuery: repeated key produces an array", () => {
  assert.deepEqual(parseQuery("a=1&a=2"), { a: ["1", "2"] });
});

test("parseQuery: three-time-repeated key", () => {
  assert.deepEqual(parseQuery("a=1&a=2&a=3"), { a: ["1", "2", "3"] });
});

test("parseQuery: + decoded as space", () => {
  assert.deepEqual(parseQuery("q=hello+world"), { q: "hello world" });
});

test("parseQuery: URI-decoded values", () => {
  assert.deepEqual(parseQuery("name=John%20Doe"), { name: "John Doe" });
});

test("parseQuery: key without = (value defaults to empty string)", () => {
  assert.deepEqual(parseQuery("flag"), { flag: "" });
});

test("parseQuery: trailing & and dangling = are tolerated", () => {
  assert.deepEqual(parseQuery("a=1&"), { a: "1" });
  assert.deepEqual(parseQuery("a=1&b="), { a: "1", b: "" });
});
