import test from "node:test";
import assert from "node:assert";
import { App } from "../../src/core/server.ts";
import { replaySnapshot } from "../../src/tools/drr/replay.ts";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";
import * as http from "http";
import * as net from "net";
import { drr, setDRRConfig } from "../../src/tools/drr/index.ts";

test("DRR Forensic Replay", async (t) => {
  const crashesDir = path.join(os.tmpdir(), `volten-test-forensic-${Date.now()}`);
  await fsPromises.mkdir(crashesDir, { recursive: true });

  await t.test("Generates forensic trace on replay", async () => {
    // 1. Create crash file
    const app = new App({ noLogs: true });
    app.enableDrr({ drr, setDRRConfig }, { outDir: crashesDir });

    const authGuard = function authGuard(ctx: any, next: () => void) {
      ctx.state.user = { id: "usr_123", role: "admin" };
      return next();
    };

    app.post("/crash", authGuard, async (ctx) => {
      await ctx.body();
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

    // 2. Replay with VOLTEN_DRR_REPLAY enabled
    process.env.VOLTEN_DRR_REPLAY = "1";
    const replayApp = new App({ noLogs: true });

    // We must register the exact same routes
    replayApp.post("/crash", authGuard, async (ctx) => {
      await ctx.body();
      throw new Error("Synthetic crash");
    });

    const rs = replayApp.listen(0);
    rs.close();

    const result = await replaySnapshot(replayApp, snapshotFile);
    assert.ok(result, "Replay should return a result");
    assert.strictEqual(result.statusCode, 500, "Should catch the crash error");

    const trace = result.trace;
    assert.ok(trace, "Trace context should be attached to replay result");
    assert.strictEqual(trace.timeline.length, 2, "Should trace authGuard and handler");

    // Timeline event 0: anonymous-middleware (the crash handler finishes first because it throws)
    const event0 = trace.timeline[0]!;
    assert.strictEqual(event0.name, "anonymous-middleware", "Innermost middleware finishes first");
    assert.ok(event0.error, "Should have caught an error");
    assert.strictEqual(event0.error!.message, "Synthetic crash", "Should be our synthetic crash");

    // Timeline event 1: authGuard (outer middleware finishes last)
    const event1 = trace.timeline[1]!;
    assert.strictEqual(event1.name, "authGuard", "Outer middleware finishes last");
    assert.strictEqual(event1.mutations.length, 1, "Should mutate state");
    assert.strictEqual(event1.mutations[0]!.key, "user", "Should mutate state.user");

    process.env.VOLTEN_DRR_REPLAY = "";
  });
});
