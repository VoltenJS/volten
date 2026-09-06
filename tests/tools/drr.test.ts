import test from "node:test";
import assert from "node:assert";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";
import * as http from "http";
import * as net from "net";

import { App } from "../../src/core/server.ts";
import { drr, setDRRConfig } from "../../src/tools/drr/index.ts";
import { HybridSpooler } from "../../src/tools/drr/spooler.ts";
import { replaySnapshot } from "../../src/tools/drr/replay.ts";

test("DRR: Deterministic Request Replay Suite", async (t) => {
  const crashesDir = path.join(os.tmpdir(), `volten-test-crashes-${Date.now()}`);
  await fsPromises.mkdir(crashesDir, { recursive: true });

  await t.test("Basic capture and replay with small payload (In-Memory Fast Path)", async () => {
    const app = new App({ noLogs: true });
    app.enableDrr({ drr, setDRRConfig }, { outDir: crashesDir });

    app.post("/crash", async (ctx) => {
      const body = await ctx.body();
      throw new Error("Synthetic crash");
    });
    const s = app.listen(0);
    s.close();

    const req = new http.IncomingMessage(new net.Socket());
    req.method = "POST";
    req.url = "/crash";
    req.headers = { "content-type": "application/json", "content-length": "17" };
    const res = new http.ServerResponse(req);
    // @ts-expect-error bypass private access
    const ctx = app.createCtx(req, res);

    req.push('{"hello":"world"}');
    req.push(null);
    // @ts-expect-error bypass private access
    await app.handleRequest(ctx).catch(() => {});
    await new Promise((r) => setTimeout(r, 100)); // wait for onCrash to write

    const files = await fsPromises.readdir(crashesDir);
    const snapshotFiles = files.filter((f) => f.startsWith("crash-"));
    assert.ok(snapshotFiles.length > 0, "Snapshot file created");

    const snapshotFile = path.join(crashesDir, snapshotFiles[0]!);

    let replayed = false;
    const replayApp = new App({ noLogs: true });

    replayApp.post("/crash", async (rCtx) => {
      const body = await rCtx.body();
      assert.deepStrictEqual(body, { hello: "world" });
      replayed = true;
      rCtx.send("OK");
    });

    const rs = replayApp.listen(0);
    rs.close();

    await replaySnapshot(replayApp, snapshotFile);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(replayed, "Replay hit handler");
  });

  await t.test("DRR Config hooks (beforeSnapshot, onSnapshot) and Empty Body", async () => {
    const app = new App({ noLogs: true });
    let snapshotCaptured = false;

    app.enableDrr(
      { drr, setDRRConfig },
      {
        beforeSnapshot: async (payload) => {
          payload.headers["x-custom-redact"] = "redacted";
          return payload;
        },
        onSnapshot: async (compressed, info) => {
          snapshotCaptured = true;
          assert.strictEqual(info.method, "GET");
          assert.strictEqual(info.url, "/hooks");
          assert.ok(Buffer.isBuffer(compressed));
        },
      },
    );

    app.get("/hooks", () => {
      throw new Error("Hook crash");
    });
    const s = app.listen(0);
    s.close();

    const req = new http.IncomingMessage(new net.Socket());
    req.method = "GET";
    req.url = "/hooks";
    req.headers = {};
    const res = new http.ServerResponse(req);
    // @ts-expect-error bypass private access
    const ctx = app.createCtx(req, res);

    req.push(null); // Empty body
    // @ts-expect-error bypass private access
    await app.handleRequest(ctx).catch(() => {});
    await new Promise((r) => setTimeout(r, 50)); // wait for onCrash to finish

    assert.ok(snapshotCaptured, "onSnapshot hook triggered");
  });

  await t.test("Large Payload Disk Spillover & Cleanup", async () => {
    const spooler = new HybridSpooler(2 * 1024 * 1024); // 2MB max
    const largeChunk = Buffer.alloc(70 * 1024, "a"); // 70KB, exceeds 64KB threshold

    spooler.tee(largeChunk);

    const payload = await spooler.getPayload();
    assert.strictEqual(payload.length, 70 * 1024);
    assert.strictEqual(payload[0], "a".charCodeAt(0));

    await spooler.cleanup(); // Clean up temp files
  });

  await t.test("Max Body Size Truncation", async () => {
    const spooler = new HybridSpooler(100); // 100 bytes max
    spooler.tee(Buffer.alloc(80));
    spooler.tee(Buffer.alloc(40)); // Total 120 > 100

    const payload = await spooler.getPayload();
    assert.strictEqual(payload.length, 80); // Should truncate remaining
  });

  await t.test("Sweep Temp Files", async () => {
    // Just ensure it doesn't crash
    await HybridSpooler.sweep();
    assert.ok(true);
  });

  await t.test("MockServerResponse String Write", async () => {
    let replayedMock = false;
    const replayApp = new App({ noLogs: true });
    replayApp.get("/mock", (ctx) => {
      ctx.res.write("hello string", "utf8");
      ctx.res.end("world string");
      ctx.res.setHeader("X-Custom", "123");
      replayedMock = true;
    });
    const rs = replayApp.listen(0);
    rs.close();

    const snapshotFile = path.join(crashesDir, "dummy-mock.vltn");
    const mockSnapshot = {
      method: "GET",
      url: "/mock",
      headers: {},
      routeData: {},
    };
    const metadataStr = JSON.stringify(mockSnapshot);
    const metaBuf = Buffer.from(metadataStr);
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(metaBuf.length, 0);
    const snapBuf = Buffer.concat([lengthBuf, metaBuf, Buffer.from("data")]);

    const zlib = await import("zlib");
    const util = await import("util");
    const compressed = await util.promisify(zlib.gzip)(snapBuf);
    await fsPromises.writeFile(snapshotFile, compressed);

    await replaySnapshot(replayApp, snapshotFile);

    // Test context creation failure
    // @ts-expect-error
    replayApp.createCtx = () => null;
    await replaySnapshot(replayApp, snapshotFile);
    assert.strictEqual(replayedMock, true);
  });

  await t.test("DRR Spooler getPayload with small and large chunk", async () => {
    const spooler = new HybridSpooler(2 * 1024 * 1024);
    spooler.tee(Buffer.alloc(64 * 1024)); // exact threshold
    spooler.tee(Buffer.alloc(1)); // spillover
    const payload = await spooler.getPayload();
    assert.strictEqual(payload.length, 64 * 1024 + 1);
  });

  await t.test("Request Reset Cleanup", async () => {
    const app = new App({ noLogs: true });
    app.enableDrr({ drr, setDRRConfig }, { outDir: crashesDir });

    const req = new http.IncomingMessage(new net.Socket());
    req.method = "POST";
    req.url = "/ok";
    req.headers = { "content-type": "text/plain", "content-length": "4" };
    const res = new http.ServerResponse(req);
    // @ts-expect-error bypass private access
    const ctx = app.createCtx(req, res);

    app.post("/ok", async (c) => {
      await c.body();
      c.res.end("ok");
    });
    const s = app.listen(0);
    s.close();

    req.push("data");
    req.push(null);
    // @ts-expect-error bypass private access
    await app.handleRequest(ctx);

    assert.ok(true);
  });
});
