import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEdgePathAndSearch, parseQuery, parseUrl } from "../../../src/utils/parseUrl.ts";

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
    const r = parseUrl("http://example.com");
    assert.deepEqual(r, { pathname: "/", queryStr: "" });
  });

  await t.test("http:// with query and no path excludes '?' from queryStr", () => {
    const r = parseUrl("http://example.com?x=1");
    assert.equal(r.pathname, "/");
    assert.equal(r.queryStr, "x=1");
  });

  await t.test("fragments are stripped from pathname", () => {
    assert.deepEqual(parseUrl("/foo#section"), { pathname: "/foo", queryStr: "" });
    const r = parseUrl("/foo?x=1#section");
    assert.equal(r.pathname, "/foo");
    assert.equal(r.queryStr, "x=1");
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

function baselineEdgePathAndSearch(urlStr: string): string {
  let relativeUrl = urlStr;
  try {
    const parsedUrl = new URL(urlStr);
    relativeUrl = parsedUrl.pathname + parsedUrl.search;
  } catch {
    // relative or invalid
  }
  return relativeUrl;
}

test("Differential URL Test Matrix: extractEdgePathAndSearch vs WHATWG URL", async (t) => {
  const cases: string[] = [
    // 1. Basic URLs
    "https://example.com/",
    "https://example.com/foo",
    "https://example.com/foo/bar",
    "https://example.com/foo/bar/",
    "http://localhost/",
    "http://localhost:3000/test",
    "http://localhost:3000/",

    // 2. Query Strings
    "https://example.com/foo?x=1",
    "https://example.com/foo/bar?foo=bar&x=1",
    "https://example.com/?x=1",
    "https://example.com/search?q=hello&filter=true&page=2",
    "https://example.com/test?a=1&b=2&c=3",
    "https://example.com/path?key=value#hash",

    // 3. Fragments (must be stripped from both pathname and search)
    "https://example.com/foo#section",
    "https://example.com/foo?x=1#section",
    "https://example.com/#",
    "https://example.com/?#",
    "https://example.com/path#",
    "https://example.com/path?#",
    "https://example.com/a?#",
    "https://example.com/#abc",
    "https://example.com/?foo=bar#abc",

    // 4. Ports
    "http://example.com:8080/foo",
    "https://example.com:443/foo",
    "http://127.0.0.1:3000/api",
    "http://[::1]:8080/v1/status",

    // 5. Percent Encoding
    "https://example.com/a%20b",
    "https://example.com/a%2Fb",
    "https://example.com/a%3Fb",
    "https://example.com/a%23b",
    "https://example.com/a%25b",
    "https://example.com/path%20with%20spaces/item%2F1",

    // 6. Unicode / Non-ASCII (triggers WHATWG URL percent-encoding fallback)
    "https://example.com/unicode/föö/bär",
    "https://example.com/測試/路徑",
    "https://example.com/emoji/🚀/test",

    // 7. Repeated Slashes
    "https://example.com//foo",
    "https://example.com///foo",
    "https://example.com/foo//bar",

    // 8. Dot Segments (triggers WHATWG path normalization fallback)
    "https://example.com/a/../b",
    "https://example.com/a/./b",
    "https://example.com/./foo",
    "https://example.com/../foo",
    "https://example.com/a/b/../../c",

    // 9. Empty Path / Missing Trailing Slash
    "https://example.com",
    "https://example.com?foo=bar",
    "http://localhost:3000",
    "http://localhost:3000?foo=bar",
    "https://example.com?",
    "https://example.com/?",

    // 10. Path-only Forms / Relative inputs
    "/foo",
    "/foo?bar=1",
    "/foo#hash",
    "/foo?bar=1#hash",
    "/foo?",
    "/foo?#",
    "/",

    // 11. Edge cases with userinfo, IPv4, IPv6
    "https://user:pass@example.com/path",
    "https://user:pass@example.com:8080/api?v=1#tag",
    "http://127.0.0.1:3000/test",
    "http://[::1]:3000/test",
    "http://example.com:80/a/b?c=d#e",
    "http://a:b@example.com:8080/a?b=c#d",

    // 12. Non-HTTP Schemes or invalid URLs
    "ftp://example.com/path",
    "ws://example.com/socket",
    "wss://example.com/socket?token=123",
    "invalid-url-string",
    "http://",
  ];

  for (const urlStr of cases) {
    await t.test(`Differential test for: ${urlStr}`, () => {
      const expected = baselineEdgePathAndSearch(urlStr);
      const actual = extractEdgePathAndSearch(urlStr);
      assert.strictEqual(
        actual,
        expected,
        `Mismatch for input "${urlStr}": expected "${expected}", got "${actual}"`,
      );
    });
  }
});

test("Deterministic Generated Differential Corpus (1,000+ permutations)", async () => {
  const schemes = ["http://", "https://", "ftp://", "ws://", "wss://", "custom://", "//", ""];

  const authorities = [
    "example.com",
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:8080",
    "[::1]",
    "[::1]:8080",
    "user:pass@example.com",
    "user:pass@example.com:8080",
    "example.com:80",
    "example.com:443",
    "",
  ];

  const paths = [
    "",
    "/",
    "/a",
    "/a/",
    "/a/b",
    "/a/b/c",
    "//a",
    "///a",
    "/a//b",
    "/a/./b",
    "/a/../b",
    "/.",
    "/..",
    "/a/.",
    "/a/..",
    "/a%2Fb",
    "/a%2fb",
    "/%2e",
    "/%2e%2e",
    "/%2E",
    "/%2E%2E",
    "/a/%2e",
    "/a/%2e%2e",
    "/a/%2E/b",
    "/a/%2E%2E/b",
    "/%2F",
    "/%5C",
    "/foo bar",
    "/foo+bar",
    "/föö/bär",
    "/🚀/test",
    "/foo\\bar",
  ];

  const queries = [
    "",
    "?",
    "?a",
    "?a=1",
    "?a=1&b=2",
    "?foo=",
    "?foo",
    "?&",
    "?=",
    "??",
    "?q=hello+world",
    "?q=hello%20world",
    "?a=1&a=2",
    "?filter=active&sort=desc",
  ];

  const fragments = ["", "#", "#fragment", "#a?b", "#/", "#section1"];

  let totalTested = 0;
  let failures = 0;
  const failureDetails: string[] = [];

  // Deterministically sample combinations using pseudo-random LCG with a fixed seed
  let seed = 123456789;
  function lcg(): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  function pick<T>(arr: T[]): T {
    return arr[Math.floor(lcg() * arr.length)] as T;
  }

  // 1. Systematic Cartesian core combinations (focused high-density matrix)
  for (const s of ["http://", "https://", ""]) {
    for (const a of ["example.com", "localhost:3000", "[::1]"]) {
      for (const p of paths) {
        for (const q of ["", "?x=1", "?a=1&b=2", "??"]) {
          for (const f of ["", "#hash"]) {
            const url = s === "" && a === "" ? p + q + f : `${s}${a}${p}${q}${f}`;
            totalTested++;
            const expected = baselineEdgePathAndSearch(url);
            const actual = extractEdgePathAndSearch(url);
            if (actual !== expected) {
              failures++;
              if (failureDetails.length < 10) {
                failureDetails.push(
                  `Mismatch for "${url}": expected "${expected}", got "${actual}"`,
                );
              }
            }
          }
        }
      }
    }
  }

  // 2. Randomized permutations with fixed seed for wide combinatorial coverage
  for (let i = 0; i < 2000; i++) {
    const s = pick(schemes);
    const a = s === "" ? "" : pick(authorities);
    const p = pick(paths);
    const q = pick(queries);
    const f = pick(fragments);

    const url = s === "" && a === "" ? p + q + f : `${s}${a}${p}${q}${f}`;
    totalTested++;
    const expected = baselineEdgePathAndSearch(url);
    const actual = extractEdgePathAndSearch(url);
    if (actual !== expected) {
      failures++;
      if (failureDetails.length < 10) {
        failureDetails.push(`Mismatch for "${url}": expected "${expected}", got "${actual}"`);
      }
    }
  }

  assert.strictEqual(
    failures,
    0,
    `Encountered ${failures} failures out of ${totalTested} generated cases:\n${failureDetails.join("\n")}`,
  );
  assert.ok(totalTested >= 2500, `Expected at least 2500 cases, tested ${totalTested}`);
});
