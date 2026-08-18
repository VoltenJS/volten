import { App } from "../core/server.ts";
import { PayloadTooLargeError } from "../core/errors.ts";
import { RequestContext } from "./requestCtx.ts";
import type { MultipartPart, FileController } from "../core/types.ts";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";
import { basename } from "path";
import * as http from "http";

function decodeQueryComponent(str: string): string {
  if (!str.includes("+") && !str.includes("%")) {
    return str;
  }
  try {
    return decodeURIComponent(str.replace(/\+/g, " "));
  } catch {
    return str;
  }
}

function fastParseUrlEncoded(input: string): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  const len = input.length;
  let start = 0;

  while (start < len) {
    let nextAmp = input.indexOf("&", start);
    if (nextAmp === -1) nextAmp = len;

    const eqIdx = input.indexOf("=", start);
    let rawKey: string, rawVal: string;

    if (eqIdx !== -1 && eqIdx < nextAmp) {
      rawKey = input.substring(start, eqIdx);
      rawVal = input.substring(eqIdx + 1, nextAmp);
    } else {
      rawKey = input.substring(start, nextAmp);
      rawVal = "";
    }

    if (rawKey.length > 0) {
      const key = decodeQueryComponent(rawKey);
      const val = decodeQueryComponent(rawVal);

      const existing = result[key];
      if (existing === undefined) {
        result[key] = val;
      } else if (Array.isArray(existing)) {
        existing.push(val);
      } else {
        result[key] = [existing, val];
      }
    }

    start = nextAmp + 1;
  }

  return result;
}

export async function parseBody(
  this: App,
  ctx: RequestContext,
  text: boolean = false,
  limit = ctx._route?.bodyLimit ?? this.AppOptions.bodyLimit,
): Promise<unknown> {
  const req = ctx.req as http.IncomingMessage;

  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    throw new Error(
      "Volten: Use ctx.multipart() to handle multipart/form-data streams. parseBody() is restricted to text/json inputs to prevent memory exhaustion.",
    );
  }

  const contentLengthHeader = req.headers["content-length"];
  if (contentLengthHeader !== undefined) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (contentLength > limit) {
      throw new PayloadTooLargeError(limit.toString());
    }
    if (contentLength === 0) {
      return App.EMPTY_OBJECT;
    }
  }

  return new Promise((resolve, reject) => {
    let receivedSize = 0;
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer) => {
      receivedSize += chunk.length;

      if (receivedSize > limit) {
        cleanup();
        reject(new PayloadTooLargeError(limit.toString()));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();

      if (chunks.length === 0) {
        resolve(App.EMPTY_OBJECT);
        return;
      }

      const rawBody = Buffer.concat(chunks, receivedSize).toString("utf8");

      if (text) {
        resolve(rawBody);
        return;
      }

      if (contentType.includes("application/x-www-form-urlencoded")) {
        resolve(fastParseUrlEncoded(rawBody));
        return;
      }

      if (contentType.includes("application/json") && chunks.length > 0) {
        try {
          resolve(JSON.parse(rawBody));
          return;
        } catch {
          resolve(rawBody);
          return;
        }
      }

      resolve(rawBody);
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function* parseMultipartStream(
  ctx: RequestContext,
): AsyncGenerator<MultipartPart, void, unknown> {
  const req = ctx.req as http.IncomingMessage;
  const contentTypeHeader = req.headers["content-type"] ?? "";

  const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (boundaryMatch === null) {
    throw new Error("Malformed Multipart: No boundary found in headers");
  }

  const boundaryStr = "--" + (boundaryMatch[1] ?? boundaryMatch[2] ?? "");
  const boundaryBuffer = Buffer.from(boundaryStr);
  const boundaryLength = boundaryBuffer.length;
  const endBoundaryBuffer = Buffer.from(boundaryStr + "--");

  const partQueue: MultipartPart[] = [];
  let resolveNextPart: (() => void) | null = null;
  let isNetworkDone: boolean = false;
  let networkError: Error | null = null;

  let residue = Buffer.alloc(0);
  let currentFileController: FileController | null = null;
  let searchingForFirstBoundary = true;
  let inHeaderSection = false;
  let activePartMeta: {
    name?: string;
    filename?: string | undefined;
    contentType?: string;
  } | null = null;

  const processChunk = (chunk: Buffer) => {
    residue = Buffer.concat([residue, chunk]);

    while (residue.length >= boundaryLength) {
      if (inHeaderSection) {
        const headerEndIndex = residue.indexOf("\r\n\r\n");
        if (headerEndIndex === -1) break;

        const headersString = residue.subarray(0, headerEndIndex).toString("utf8");
        residue = residue.subarray(headerEndIndex + 4);
        inHeaderSection = false;

        if (headersString.toLowerCase().includes("content-disposition: form-data")) {
          const nameMatch = headersString.match(/name="([^"]+)"/i);
          const filenameMatch = headersString.match(/filename="([^"]+)"/i);
          const contentTypeMatch = headersString.match(/Content-Type:\s*([^\r\n;]+)/i);

          activePartMeta = {
            name: nameMatch !== null ? (nameMatch[1] ?? "") : "",
            filename: filenameMatch !== null ? (filenameMatch[1] ?? "") : undefined,
            contentType: contentTypeMatch !== null ? (contentTypeMatch[1] ?? "").trim() : "",
          };

          if (activePartMeta.filename !== undefined) {
            const nodeCompatibleStream = new Readable({
              highWaterMark: 1024 * 1024,
              read() {},
            });

            currentFileController = {
              enqueue(c: Uint8Array) {
                nodeCompatibleStream.push(c);
              },
              close() {
                nodeCompatibleStream.push(null);
              },
            };

            const saveMethod = async (targetPath: string): Promise<void> => {
              await mkdir(dirname(targetPath), { recursive: true });
              const writeStream = createWriteStream(targetPath);
              await pipeline(nodeCompatibleStream, writeStream);
            };

            const bufferMethod = async (): Promise<Buffer> => {
              const chunks: Uint8Array[] = [];
              for await (const chunk of nodeCompatibleStream) {
                chunks.push(chunk as Uint8Array);
              }
              return Buffer.concat(chunks);
            };
            partQueue.push({
              isFile: true,
              name: activePartMeta.name ?? "",
              filename: basename(activePartMeta.filename ?? ""),
              contentType: activePartMeta.contentType ?? "",
              stream: nodeCompatibleStream,
              save: saveMethod,
              buffer: bufferMethod,
              text: async () => (await bufferMethod()).toString("utf8"),
            });

            if (resolveNextPart !== null) {
              resolveNextPart();
              resolveNextPart = null;
            }
          }
        }
        continue;
      }

      const index = residue.indexOf(boundaryBuffer);

      if (index === -1) {
        const safeKeepLength = boundaryLength + 4;
        if (residue.length > safeKeepLength) {
          const streamablePart = residue.subarray(0, residue.length - safeKeepLength);
          if (currentFileController !== null) {
            currentFileController.enqueue(
              new Uint8Array(
                streamablePart.buffer,
                streamablePart.byteOffset,
                streamablePart.byteLength,
              ),
            );
          }
          residue = residue.subarray(residue.length - safeKeepLength);
        }
        break;
      }

      if (!searchingForFirstBoundary && index > 0) {
        let dataLength = index;
        if (residue[index - 1] === 0x0a) {
          dataLength--;
          if (residue[index - 2] === 0x0d) dataLength--;
        }

        const exactDataBlock = residue.subarray(0, dataLength);

        if (currentFileController !== null) {
          currentFileController.enqueue(
            new Uint8Array(
              exactDataBlock.buffer,
              exactDataBlock.byteOffset,
              exactDataBlock.byteLength,
            ),
          );
          currentFileController.close();
          currentFileController = null;
        } else if (activePartMeta !== null && activePartMeta.filename === undefined) {
          partQueue.push({
            isFile: false,
            name: activePartMeta.name ?? "",
            value: exactDataBlock.toString("utf8"),
          });

          if (resolveNextPart !== null) {
            resolveNextPart();
            resolveNextPart = null;
          }
        }
      }

      if (residue.indexOf(endBoundaryBuffer) === index) {
        if (currentFileController !== null) {
          currentFileController.close();
          currentFileController = null;
        }
        isNetworkDone = true;
        if (resolveNextPart !== null) {
          resolveNextPart();
          resolveNextPart = null;
        }
        return;
      }

      if (currentFileController !== null) {
        currentFileController.close();
        currentFileController = null;
      }

      searchingForFirstBoundary = false;
      let nextSectionStart = index + boundaryLength;

      if (residue[nextSectionStart] === 0x0d) nextSectionStart++;
      if (residue[nextSectionStart] === 0x0a) nextSectionStart++;

      residue = residue.subarray(nextSectionStart);
      inHeaderSection = true;
    }
  };

  const onData = (chunk: Buffer) => {
    try {
      processChunk(chunk);
    } catch (err) {
      networkError = err as Error;
      if (resolveNextPart !== null) resolveNextPart();
    }
  };

  const onEnd = () => {
    if (currentFileController !== null) {
      currentFileController.close();
    }
    isNetworkDone = true;
    if (resolveNextPart !== null) resolveNextPart();
  };

  const onError = (err: Error) => {
    networkError = err;
    if (resolveNextPart !== null) resolveNextPart();
  };

  req.on("data", onData);
  req.on("end", onEnd);
  req.on("error", onError);

  try {
    for (;;) {
      if ((networkError as Error | null) !== null) throw networkError as unknown as Error;

      if (partQueue.length > 0) {
        const part = partQueue.shift();
        if (part !== undefined) {
          yield part;
        }
        continue;
      }

      if (isNetworkDone as boolean) break;

      await new Promise<void>((resolve) => {
        resolveNextPart = resolve;
      });
    }
  } finally {
    req.off("data", onData);
    req.off("end", onEnd);
    req.off("error", onError);

    if (typeof req.pause === "function") {
      req.pause();
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (currentFileController !== null) {
      (currentFileController as FileController).close();
      currentFileController = null;
    }

    partQueue.length = 0;
    residue = Buffer.alloc(0);
    resolveNextPart = null;
  }
}
