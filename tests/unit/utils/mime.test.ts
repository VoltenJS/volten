import { test } from "node:test";
import assert from "node:assert/strict";
import { getMimeType } from "../../../src/utils/mime.ts";
test("getMimeType: text & code MIME types", () => {
  assert.equal(getMimeType("html"), "text/html");
  assert.equal(getMimeType("htm"), "text/html");
  assert.equal(getMimeType("js"), "text/javascript");
  assert.equal(getMimeType("mjs"), "text/javascript");
  assert.equal(getMimeType("css"), "text/css");
  assert.equal(getMimeType("json"), "application/json");
  assert.equal(getMimeType("jsonld"), "application/ld+json");
  assert.equal(getMimeType("txt"), "text/plain; charset=utf-8");
  assert.equal(getMimeType("xml"), "application/xml");
});
test("getMimeType: image MIME types", () => {
  assert.equal(getMimeType("png"), "image/png");
  assert.equal(getMimeType("jpg"), "image/jpeg");
  assert.equal(getMimeType("jpeg"), "image/jpeg");
  assert.equal(getMimeType("gif"), "image/gif");
  assert.equal(getMimeType("webp"), "image/webp");
  assert.equal(getMimeType("avif"), "image/avif");
  assert.equal(getMimeType("svg"), "image/svg+xml");
  assert.equal(getMimeType("ico"), "image/x-icon");
  assert.equal(getMimeType("bmp"), "image/bmp");
  assert.equal(getMimeType("tiff"), "image/tiff");
});

test("getMimeType: font MIME types", () => {
  assert.equal(getMimeType("woff"), "font/woff");
  assert.equal(getMimeType("woff2"), "font/woff2");
  assert.equal(getMimeType("ttf"), "font/ttf");
  assert.equal(getMimeType("otf"), "font/otf");
  assert.equal(getMimeType("eot"), "application/vnd.ms-fontobject");
});

test("getMimeType: video MIME types", () => {
  assert.equal(getMimeType("mp4"), "video/mp4");
  assert.equal(getMimeType("webm"), "video/webm");
  assert.equal(getMimeType("ogv"), "video/ogg");
  assert.equal(getMimeType("mov"), "video/quicktime");
  assert.equal(getMimeType("avi"), "video/x-msvideo");
});

test("getMimeType: audio MIME types", () => {
  assert.equal(getMimeType("mp3"), "audio/mpeg");
  assert.equal(getMimeType("wav"), "audio/wav");
  assert.equal(getMimeType("flac"), "audio/flac");
  assert.equal(getMimeType("ogg"), "audio/ogg");
  assert.equal(getMimeType("m4a"), "audio/mp4");
  assert.equal(getMimeType("aac"), "audio/aac");
});

test("getMimeType: document MIME types", () => {
  assert.equal(getMimeType("pdf"), "application/pdf");
  assert.equal(getMimeType("zip"), "application/zip");
  assert.equal(getMimeType("gz"), "application/gzip");
  assert.equal(getMimeType("rar"), "application/vnd.rar");
  assert.equal(getMimeType("7z"), "application/x-7z-compressed");
  assert.equal(getMimeType("tar"), "application/x-tar");
  assert.equal(getMimeType("doc"), "application/msword");
  assert.equal(
    getMimeType("docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(getMimeType("xls"), "application/vnd.ms-excel");
  assert.equal(
    getMimeType("xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(getMimeType("ppt"), "application/vnd.ms-powerpoint");
  assert.equal(
    getMimeType("pptx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.equal(getMimeType("csv"), "text/csv");
});

test("getMimeType: binary fallbacks", () => {
  assert.equal(getMimeType("bin"), "application/octet-stream");
  assert.equal(getMimeType("exe"), "application/octet-stream");
  assert.equal(getMimeType("wasm"), "application/wasm");
  // Unknown extension falls through to octet-stream
  assert.equal(getMimeType("xyz_unknown"), "application/octet-stream");
  // Case-insensitive lookup (the function lowercases the input)
  assert.equal(getMimeType("PNG"), "image/png");
  assert.equal(getMimeType("JSON"), "application/json");
});
