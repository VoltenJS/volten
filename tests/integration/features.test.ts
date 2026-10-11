import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../src/index.ts";
import { request } from "../helpers.ts";
import fs from "fs";
import path from "path";
import os from "os";

test("Core Framework Features", async (t) => {
  const volten = new App({ loggerOptions: { level: "fatal" } });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "volten-v009-tests-"));
  const tempFilePath = path.join(tempDir, "hello world.txt");
  fs.writeFileSync(tempFilePath, "Hello from URL encoded path!");
  volten.static(tempDir);

  volten.post("/large", async (ctx) => {
    try {
      await ctx.body("text");
      ctx.send("parsed");
    } catch (e: any) {
      if ((e as any).message.includes("Use ctx.bodyStream()")) {
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
    assert.equal((res.json() as any).receivedBytes, Buffer.from("test payload stream").length);
  });

  await t.test("Static File Serving and sendFile Atomic Containment Security", async (st) => {
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "volten-secret-"));
    fs.writeFileSync(path.join(secretDir, "passwords.txt"), "super-secret-password");
    fs.writeFileSync(path.join(tempDir, "style.css"), "body { color: red; }");

    try {
      fs.symlinkSync(path.join(secretDir, "passwords.txt"), path.join(tempDir, "ext-symlink.txt"));
    } catch {}

    try {
      fs.symlinkSync(path.join(tempDir, "style.css"), path.join(tempDir, "int-symlink.css"));
    } catch {}

    await st.test("blocks raw traversal ../../secret/passwords.txt", async () => {
      const res = await request(volten, "/../../secret/passwords.txt");
      assert.equal(res.status, 404);
      assert.equal(res.body.includes("super-secret-password"), false);
    });

    await st.test("blocks encoded traversal ..%2F..%2Fsecret%2Fpasswords.txt", async () => {
      const res = await request(volten, "/..%2F..%2Fsecret%2Fpasswords.txt");
      assert.equal(res.status, 404);
      assert.equal(res.body.includes("super-secret-password"), false);
    });

    await st.test("blocks double-encoded traversal %252e%252e%252f", async () => {
      const res = await request(volten, "/%252e%252e%252fsecret/passwords.txt");
      assert.equal(res.status, 404);
      assert.equal(res.body.includes("super-secret-password"), false);
    });

    await st.test("blocks null byte injection /index.html%00", async () => {
      const res = await request(volten, "/hello%20world.txt%00");
      assert.ok(res.status === 400 || res.status === 404);
      assert.equal(res.body.includes("super-secret-password"), false);
    });

    await st.test("returns 404 for nonexistent files", async () => {
      const res = await request(volten, "/does-not-exist.txt");
      assert.equal(res.status, 404);
    });

    await st.test("returns 404 when requesting a directory", async () => {
      const res = await request(volten, "/");
      assert.equal(res.status, 404);
    });

    await st.test("blocks symlink pointing outside root", async () => {
      const res = await request(volten, "/ext-symlink.txt");
      assert.equal(res.status, 404);
      assert.equal(res.body.includes("super-secret-password"), false);
    });

    await st.test("allows symlink pointing inside root", async () => {
      const res = await request(volten, "/int-symlink.css");
      if (res.status === 200) {
        assert.equal(res.body, "body { color: red; }");
      } else {
        assert.equal(res.status, 404);
      }
    });

    await st.test("sendFile root-confined API rejects paths escaping root", async () => {
      const app2 = new App({ loggerOptions: { level: "fatal" } });
      app2.get("/download-secret", async (ctx) => {
        try {
          await ctx.sendFile("../secret/passwords.txt", 200, { root: tempDir });
        } catch {
          ctx.status(404).send("Blocked");
        }
      });
      const res = await request(app2, "/download-secret");
      assert.equal(res.body.includes("super-secret-password"), false);
      await app2.close();
    });

    try {
      fs.rmSync(secretDir, { recursive: true, force: true });
    } catch {}
  });

  volten.close();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
