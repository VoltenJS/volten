import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentDispositionAttachment,
  extractMediaType,
  ifNoneMatchMatches,
  isJsonMediaType,
  parseCookieHeader,
  serializeSetCookie,
  shouldSendContent,
} from "../../../src/utils/httpRfc.ts";

test("HTTP RFC helpers", async (t) => {
  await t.test("shouldSendContent omits HEAD, 204, and 304", () => {
    assert.equal(shouldSendContent("GET", 200), true);
    assert.equal(shouldSendContent("HEAD", 200), false);
    assert.equal(shouldSendContent("GET", 204), false);
    assert.equal(shouldSendContent("POST", 304), false);
    assert.equal(shouldSendContent("GET", 100), false);
  });

  await t.test("If-None-Match matches lists, weak tags, and *", () => {
    const etag = `W/"abc"`;
    assert.equal(ifNoneMatchMatches(etag, etag), true);
    assert.equal(ifNoneMatchMatches(`W/"nope", W/"abc"`, etag), true);
    assert.equal(ifNoneMatchMatches(`"abc"`, etag), true);
    assert.equal(ifNoneMatchMatches("*", etag), true);
    assert.equal(ifNoneMatchMatches(`W/"other"`, etag), false);
    assert.equal(ifNoneMatchMatches(undefined, etag), false);
  });

  await t.test("SameSite=None implies Secure", () => {
    const cookie = serializeSetCookie("sid", "1", { sameSite: "none" });
    assert.ok(cookie.includes("SameSite=None"));
    assert.ok(cookie.includes("Secure"));
  });

  await t.test("cookie parser strips quotes and empty names", () => {
    const parsed = parseCookieHeader(`a="b"; =skip; theme=dark`);
    assert.equal(parsed["a"], "b");
    assert.equal(parsed["theme"], "dark");
    assert.equal(parsed[""], undefined);
  });

  await t.test("media type parsing ignores parameters", () => {
    assert.equal(extractMediaType("application/json; charset=utf-8"), "application/json");
    assert.equal(isJsonMediaType("application/json"), true);
    assert.equal(isJsonMediaType("application/ld+json"), true);
    assert.equal(isJsonMediaType("text/plain"), false);
  });

  await t.test("Content-Disposition includes filename and filename*", () => {
    const header = contentDispositionAttachment("résumé.pdf");
    assert.ok(header.includes(`filename="`));
    assert.ok(header.includes("filename*=UTF-8''"));
  });
});
