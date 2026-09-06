import { App } from "../../core/server.ts";
import * as http from "http";
import fsPromises from "fs/promises";
import zlib from "zlib";
import { promisify } from "util";
import type { SnapshotPayload } from "../../core/types.ts";
import { Socket } from "net";

const unzip = promisify(zlib.unzip);

export class MockServerResponse extends http.ServerResponse {
  public mockBuffer: Buffer[] = [];
  public _headers: Record<string, string | number | string[]> = {};

  override write(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
    if (Buffer.isBuffer(chunk)) {
      this.mockBuffer.push(chunk);
    } else if (typeof chunk === "string") {
      this.mockBuffer.push(
        Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8"),
      );
    }
    if (typeof callback === "function") (callback as () => void)();
    return true;
  }

  override end(chunk?: unknown, encoding?: unknown, callback?: unknown): this {
    if (chunk !== undefined) {
      this.write(chunk, encoding);
    }
    this.emit("finish");
    if (typeof callback === "function") (callback as () => void)();
    return this;
  }

  override setHeader(name: string, value: string | number | string[]): this {
    this._headers[name.toLowerCase()] = value;
    return super.setHeader(name, value);
  }
}

import type { ReplayTraceContext } from "./tracer.ts";

export interface ReplayResult {
  statusCode: number;
  headers: Record<string, string | number | string[]>;
  body: Buffer;
  trace?: ReplayTraceContext;
}

export async function replaySnapshot(app: App, filePath: string): Promise<ReplayResult | null> {
  const compressed = await fsPromises.readFile(filePath);
  const snapshotBuffer = await unzip(compressed);

  const length = snapshotBuffer.readUInt32BE(0);
  const metadataBuffer = snapshotBuffer.subarray(4, 4 + length);
  const bodyBuffer = snapshotBuffer.subarray(4 + length);

  const metadata = JSON.parse(metadataBuffer.toString("utf8")) as Partial<SnapshotPayload>;

  const req = new http.IncomingMessage(new Socket());
  req.method = metadata.method !== undefined ? metadata.method : "GET";
  req.url = metadata.url !== undefined ? metadata.url : "/";
  req.headers = metadata.headers !== undefined ? metadata.headers : {};

  req.push(bodyBuffer);
  req.push(null);

  const res = new MockServerResponse(req);

  // Directly access the app's createCtx logic. Since it's private, we bypass via checkout
  // @ts-expect-error bypass private method access
  const ctx = app.createCtx(req, res);
  if (ctx === null) {
    console.error("Failed to create context for replay");
    return null;
  }
  ctx.state["__volten_drr_replay"] = true;

  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        const body = Buffer.concat(res.mockBuffer);
        const trace = ctx.state["__volten_drr_trace"] as ReplayTraceContext;
        req.socket.destroy();
        resolve({
          statusCode: res.statusCode,
          headers: res._headers,
          body,
          trace,
        });
      }
    };
    res.on("finish", done);
    res.on("close", done);
    res.on("error", done);

    // Execute
    app.getRouteTree().clear();
    // @ts-expect-error app<string> assigned to app<never>
    app.register(app);
    // @ts-expect-error bypass private method access
    app.handleRequest(ctx).catch(console.error);
  });
}
