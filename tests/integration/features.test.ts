import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../src/index.ts";
import { request } from "../helpers.ts";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "node:stream";

test("Core Framework Features", async (t) => {
  const volten = new App({ noLogs: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "volten-v009-tests-"));
  const tempFilePath = path.join(tempDir, "hello world.txt");
  fs.writeFileSync(tempFilePath, "Hello from URL encoded path!");
  volten.static(tempDir);

  volten.post("/large", async (ctx) => {
    try {
      await ctx.body("text");
      ctx.send("parsed");
    } catch (e: any) {
      if (e.message.includes("Use ctx.bodyStream()")) {
        ctx.statusCode = 413;
        ctx.send("too large");
      } else {
        ctx.statusCode = 500;
        ctx.send("other error");
      }
    }
  });

  volten.post("/stream", async (ctx) => {
    const stream = ctx.bodyStream;
    if (!stream) {
      ctx.json({ receivedBytes: 0 });
      return;
    }

    let size = 0;
    // Natively loop through chunks without conversion
    for await (const chunk of stream as any) {
      size += chunk.length;
    }

    ctx.json({ receivedBytes: size });
  });

  await t.test(
    "JSON-aware error handler formats 404 as JSON if Accept header matches",
    async () => {
      const res = await request(volten, "/non-existent-api", {
        headers: { Accept: "application/json" },
      });

      assert.equal(res.status, 404);
      assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
      assert.deepEqual(res.json(), { error: "Route Not Found", code: 404 });
    },
  );

  await t.test("URL Encoded Paths are correctly routed for static files", async () => {
    const res = await request(volten, "/hello%20world.txt");
    assert.equal(res.status, 200);
    assert.equal(res.body, "Hello from URL encoded path!");
  });

  await t.test("ETag caching returns 304 Not Modified for static files", async () => {
    const res1 = await request(volten, "/hello%20world.txt");
    assert.equal(res1.status, 200);
    const etag = res1.headers["etag"];
    assert.ok(etag, "ETag header is missing");

    const res2 = await request(volten, "/hello%20world.txt", {
      headers: { "If-None-Match": etag },
    });
    assert.equal(res2.status, 304);
    assert.equal(res2.body, "");
  });

  await t.test("ctx.bodyStream() safely consumes payload", async () => {
    const res = await request(volten, "/stream", {
      method: "POST",
      body: "test payload stream",
    });

    assert.equal(res.status, 200);
    assert.equal(res.json().receivedBytes, Buffer.from("test payload stream").length);
  });
});
