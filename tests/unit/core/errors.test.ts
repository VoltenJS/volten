import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VoltenError,
  HeadersSentError,
  ResponseSentError,
  InvalidNextCallError,
  BodyReadOnInvalidMethodError,
  NotFoundError,
  MethodNotAllowedError,
  ServiceUnavailableError,
  PayloadTooLargeError,
} from "../../../src/core/errors.ts";

test("Errors Unit Tests", async (t) => {
  await t.test("toJSON without stack", () => {
    const err = new VoltenError("ERR_TEST", "msg", 418);
    const json = err.toJSON();
    assert.equal(json.error.name, "VoltenError");
    assert.equal(json.error.code, "ERR_TEST");
    assert.equal(json.error.message, "msg");
    assert.equal(json.error.statusCode, 418);
    assert.equal(json.error.stack, undefined);
  });

  await t.test("toJSON with stack", () => {
    const err = new VoltenError("ERR_TEST", "msg", 418);
    const json = err.toJSON(true);
    assert.ok(typeof json.error.stack === "string");
  });

  await t.test("returns same instance when already a VoltenError", () => {
    const original = new VoltenError("ERR_X", "x", 500);
    const converted = VoltenError.from(original);
    assert.strictEqual(converted, original);
  });

  await t.test("converts a generic Error", () => {
    const err = new Error("plain message");
    const converted = VoltenError.from(err);
    assert.ok(converted instanceof VoltenError);
    assert.equal(converted.code, "ERR_INTERNAL_SERVER_ERROR");
    assert.equal(converted.message, "plain message");
    assert.equal(converted.statusCode, 500);
  });

  await t.test("converts a non-Error value (string)", () => {
    const converted = VoltenError.from("something went wrong");
    assert.ok(converted instanceof VoltenError);
    assert.equal(converted.message, "something went wrong");
  });

  await t.test("true for VoltenError instance", () => {
    assert.equal(VoltenError.isVoltenError(new VoltenError("E", "m", 500)), true);
  });

  await t.test("false for plain Error", () => {
    assert.equal(VoltenError.isVoltenError(new Error("e")), false);
  });

  await t.test("stack trace is preserved when from(Error)", () => {
    const original = new Error("stacked");
    const converted = VoltenError.from(original);
    assert.ok(typeof converted.stack === "string");
    assert.ok(converted.stack!.includes("stacked"));
  });

  await t.test("has correct code and message", () => {
    const err = new HeadersSentError();
    assert.equal(err.code, "ERR_HEADERS_SENT");
    assert.equal(err.statusCode, 500);
    assert.ok(err.message.includes("headers"));
    assert.equal(err.name, "HeadersSentError");
  });

  await t.test("has correct code and message", () => {
    const err = new ResponseSentError();
    assert.equal(err.code, "ERR_RESPONSE_SENT");
    assert.equal(err.statusCode, 500);
    assert.equal(err.name, "ResponseSentError");
  });

  await t.test("has correct code and message", () => {
    const err = new InvalidNextCallError();
    assert.equal(err.code, "ERR_INVALID_NEXT_CALL");
    assert.equal(err.statusCode, 500);
    assert.equal(err.name, "InvalidNextCallError");
  });

  await t.test("has correct code, method, status", () => {
    const err = new BodyReadOnInvalidMethodError("GET");
    assert.equal(err.code, "ERR_BODY_READ_ON_INVALID_METHOD");
    assert.equal(err.statusCode, 400);
    assert.ok(err.message.includes("GET"));
    assert.equal(err.name, "BodyReadOnInvalidMethodError");
  });

  await t.test("default message", () => {
    const err = new NotFoundError();
    assert.equal(err.code, "ERR_NOT_FOUND");
    assert.equal(err.statusCode, 404);
    assert.equal(err.message, "Resource not found");
    assert.equal(err.name, "NotFoundError");
  });

  await t.test("custom message", () => {
    const err = new NotFoundError("custom 404");
    assert.equal(err.message, "custom 404");
  });

  await t.test("contains method and allowed list", () => {
    const err = new MethodNotAllowedError("TRACE", ["GET", "POST"]);
    assert.equal(err.code, "ERR_METHOD_NOT_ALLOWED");
    assert.equal(err.statusCode, 405);
    assert.ok(err.message.includes("TRACE"));
    assert.ok(err.message.includes("GET"));
    assert.ok(err.message.includes("POST"));
    assert.equal(err.name, "MethodNotAllowedError");
  });

  await t.test("default and custom message", () => {
    const def = new ServiceUnavailableError();
    assert.equal(def.code, "ERR_SERVICE_UNAVAILABLE");
    assert.equal(def.statusCode, 503);
    assert.equal(def.message, "Service is currently unavailable");
    const custom = new ServiceUnavailableError("offline");
    assert.equal(custom.message, "offline");
  });

  await t.test("includes limit in message", () => {
    const err = new PayloadTooLargeError("1024");
    assert.equal(err.code, "ERR_PAYLOAD_TOO_LARGE");
    assert.equal(err.statusCode, 413);
    assert.ok(err.message.includes("1024"));
  });
});
