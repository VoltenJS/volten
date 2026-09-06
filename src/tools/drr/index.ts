import { RequestContext } from "../../utils/requestCtx.ts";
import { VoltenError } from "../../core/errors.ts";
import type { DRRConfig, DRRPlugin, SnapshotPayload } from "../../core/types.ts";
import { HybridSpooler } from "./spooler.ts";
import zlib from "zlib";
import { promisify } from "util";
import fsPromises from "fs/promises";
import path from "path";

const gzip = promisify(zlib.gzip);

const spoolers = new WeakMap<RequestContext, HybridSpooler>();

let config: DRRConfig = {};

export const drr: DRRPlugin = {
  tee(ctx: RequestContext, chunk: Buffer) {
    if (ctx.state["__volten_drr_replay"] === true) return;
    let spooler = spoolers.get(ctx);
    if (spooler === undefined) {
      spooler = new HybridSpooler(config.maxBodySize);
      spoolers.set(ctx, spooler);
    }
    spooler.tee(chunk);
  },

  async onCrash(ctx: RequestContext, error: VoltenError) {
    if (ctx.state["__volten_drr_replay"] === true) return;
    const spooler = spoolers.get(ctx);
    const bodyBuffer = spooler !== undefined ? await spooler.getPayload() : Buffer.alloc(0);

    const payload: SnapshotPayload = {
      method: ctx.method,
      url: ctx.url,
      headers: ctx.headers,
      body: bodyBuffer,
    };

    if (ctx._route !== null) {
      payload.routeData = { path: ctx.path };
    }

    let finalPayload = payload;
    if (config.beforeSnapshot !== undefined) {
      finalPayload = await config.beforeSnapshot(payload);
    }

    const metaObj = {
      method: finalPayload.method,
      url: finalPayload.url,
      headers: finalPayload.headers,
      routeData: finalPayload.routeData,
    };
    const metadataBuffer = Buffer.from(JSON.stringify(metaObj));

    // Protocol: [4 bytes metadata length] + [metadata JSON bytes] + [body bytes]
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(metadataBuffer.length, 0);

    const snapshotBuffer = Buffer.concat([lengthBuffer, metadataBuffer, finalPayload.body]);
    const compressed = await gzip(snapshotBuffer);

    if (config.onSnapshot !== undefined) {
      await config.onSnapshot(compressed, {
        method: finalPayload.method,
        url: finalPayload.url,
        error,
      });
    } else {
      const outDir =
        config.outDir !== undefined ? config.outDir : path.join(process.cwd(), ".volten-crashes");
      await fsPromises.mkdir(outDir, { recursive: true });
      const filePath = path.join(outDir, `crash-${String(Date.now())}.vltn`);
      await fsPromises.writeFile(filePath, compressed);
    }
  },

  onReset(ctx: RequestContext) {
    const spooler = spoolers.get(ctx);
    if (spooler !== undefined) {
      void spooler.cleanup();
    }
  },
};

export function setDRRConfig(cfg: DRRConfig) {
  config = cfg;
  void HybridSpooler.sweep();
}
