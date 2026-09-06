import test from "node:test";
import assert from "node:assert";
import { App } from "../../src/core/server.ts";
import { drr, setDRRConfig } from "../../src/tools/drr/index.ts";
import { formatValue, diffState, traceMiddleware } from "../../src/tools/drr/tracer.ts";
import { HybridSpooler } from "../../src/tools/drr/spooler.ts";
import { MockServerResponse, replaySnapshot } from "../../src/tools/drr/replay.ts";
import * as http from "http";
import * as net from "net";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";

test("DRR Tracer formatValue and diffState Edge Cases", () => {
  // undefined
  assert.strictEqual(formatValue(undefined), undefined);

  // function anonymous
  assert.strictEqual(
    formatValue(function () {}),
    "[Function: anonymous]",
  );

  // function named
  const namedFn = function myFunc() {};
  assert.strictEqual(formatValue(namedFn), "[Function: myFunc]");

  // Class constructor
  class MyCustomClass {}
  assert.strictEqual(formatValue(new MyCustomClass()), "[MyCustomClass]");

  // Circular object
  const circ: any = {};
  circ.self = circ;
  assert.strictEqual(formatValue(circ), "[Circular]");

  // Primitive
  assert.strictEqual(formatValue(42), Object.prototype.toString.call(42));
});

test("DRR Spooler stream finish/error/close branches", async () => {
  const spooler = new HybridSpooler(100 * 1024);
  // Force file stream mode
  spooler.tee(Buffer.alloc(70 * 1024));
  assert.ok(spooler["tempFilePath"]);

  // simulate early stream finish
  const ws = spooler["writeStream"]!;

  // Manually call getPayload
  const p = spooler.getPayload();
  ws.emit("error", new Error("fake stream error"));

  const buf = await p;
  assert.ok(Buffer.isBuffer(buf));
});

test("DRR Tracer traceMiddleware sync throw & success", () => {
  const ctx = { state: {} } as any;
  let successCalled = false;

  // success sync
  traceMiddleware(ctx, "syncPass", () => {
    successCalled = true;
    return "done";
  });
  assert.ok(successCalled);
  assert.strictEqual(ctx.state["__volten_drr_trace"].timeline.length, 1);
  assert.strictEqual(ctx.state["__volten_drr_trace"].timeline[0].name, "syncPass");

  // throw sync
  assert.throws(() => {
    traceMiddleware(ctx, "syncFail", () => {
      throw new Error("sync failure");
    });
  });
  assert.strictEqual(ctx.state["__volten_drr_trace"].timeline.length, 2);
  assert.strictEqual(ctx.state["__volten_drr_trace"].timeline[1].name, "syncFail");
});

test("DRR Index onReset & empty body & routeData", async () => {
  const app = new App({ noLogs: true });
  app.enableDrr({ drr, setDRRConfig });

  let snapCompressed: Buffer | null = null;
  setDRRConfig({
    onSnapshot: async (comp) => {
      snapCompressed = comp;
    },
  });

  const req = new http.IncomingMessage(new net.Socket());
  req.method = "POST";
  req.url = "/empty";
  req.headers = {};
  const res = new http.ServerResponse(req);
  const ctx = app.createCtx(req, res);

  // Test drr plugin directly
  // 1. replay = true bypass
  ctx.state["__volten_drr_replay"] = true;
  drr.tee!(ctx, Buffer.from("test"));
  await drr.onCrash!(ctx, new Error("test"));

  // 2. drr tee creates spooler
  ctx.state["__volten_drr_replay"] = false;
  drr.tee!(ctx, Buffer.from("real data"));

  // 3. set routeData
  ctx._route = { path: "/empty" } as any;
  ctx.path = "/empty";
  await drr.onCrash!(ctx, new Error("test"));

  assert.ok(snapCompressed);

  // 4. onReset
  drr.onReset!(ctx);
  req.socket.destroy();
});

test("DRR Spooler getPayload read file error", async () => {
  const spooler = new HybridSpooler(100 * 1024);
  spooler.tee(Buffer.alloc(70 * 1024));

  // mock file path to something invalid
  spooler["tempFilePath"] = "/invalid/path/that/does/not/exist";

  const payload = await spooler.getPayload();
  assert.strictEqual(payload.length, 0);
});

test("DRR spooler cleanup without file", async () => {
  const spooler = new HybridSpooler(10);
  spooler.tee(Buffer.alloc(5));
  await spooler.cleanup();
  assert.strictEqual(spooler["bufferSize"], 0);
});

test("DRR Spooler stream early close", async () => {
  const spooler = new HybridSpooler(100 * 1024);
  spooler.tee(Buffer.alloc(70 * 1024));
  const ws = spooler["writeStream"]!;
  const p = spooler.getPayload();
  ws.emit("close");
  await p;
});

test("DRR MockServerResponse Edge Cases", () => {
  const req = new http.IncomingMessage(new net.Socket());
  const res = new MockServerResponse(req);

  // write with string and no encoding
  let cbCalled1 = false;
  res.write("hello", undefined, () => {
    cbCalled1 = true;
  });
  assert.ok(cbCalled1);

  // end with encoding and callback
  let cbCalled2 = false;
  res.end("world", "hex", () => {
    cbCalled2 = true;
  });
  assert.ok(cbCalled2);
  req.socket.destroy();
});
