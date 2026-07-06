import { App } from "../core/server.ts";
import {
  PAYLOAD_TOO_LARGE_BUF,
  PAYLOAD_TOO_LARGE_HEADERS,
} from "../core/types.ts";
import { PayloadTooLargeError } from "../core/errors.ts";
import { RequestContext } from "./requestCtx.ts";
import { MultipartPart } from "../core/types.ts";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";

/**
 * Standard Body Parser for JSON, Text, and URL-encoded data.
 */
export async function parseBody(
  this: App,
  ctx: RequestContext,
  text: boolean = false,
  limit = ctx.route?.bodyLimit || this.AppOptions.bodyLimit,
): Promise<unknown> {
  const req = ctx.req!;
  const res = ctx.res!;

  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    throw new Error(
      "Volten: Use ctx.multipart() to handle multipart/form-data streams. parseBody() is restricted to text/json inputs to prevent memory exhaustion.",
    );
  }

  const contentLengthHeader = req.headers["content-length"];
  if (contentLengthHeader !== undefined) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (contentLength > limit) {
      res.writeHead(413, PAYLOAD_TOO_LARGE_HEADERS).end(PAYLOAD_TOO_LARGE_BUF);
      this.resetCtx(ctx);
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
        req.destroy();
        reject(new PayloadTooLargeError(limit.toString()));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();

      if (chunks.length === 0) {
        return resolve(App.EMPTY_OBJECT);
      }

      const rawBody = Buffer.concat(chunks, receivedSize).toString("utf8");

      if (
        (contentType.includes("application/json") || chunks.length > 0) &&
        !text
      ) {
        try {
          return resolve(JSON.parse(rawBody));
        } catch {
          return resolve(rawBody);
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

/**
 * Native, zero-dependency streaming multipart parser.
 * Driven via a decoupled async event processor to prevent generator deadlocks.
 */
export async function* parseMultipartStream(
  ctx: RequestContext,
): AsyncGenerator<MultipartPart, void, unknown> {
  const req = ctx.req!;
  const contentTypeHeader = req.headers["content-type"] || "";

  const boundaryMatch = contentTypeHeader.match(
    /boundary=(?:"([^"]+)"|([^;]+))/,
  );
  if (!boundaryMatch) {
    throw new Error("Malformed Multipart: No boundary found in headers");
  }

  const boundaryStr = "--" + (boundaryMatch[1] || boundaryMatch[2]);
  const boundaryBuffer = Buffer.from(boundaryStr);
  const boundaryLength = boundaryBuffer.length;
  const endBoundaryBuffer = Buffer.from(boundaryStr + "--");

  // Queue system to decouple incoming data execution from generator consumption
  const partQueue: MultipartPart[] = [];
  let resolveNextPart: ((value: void) => void) | null = null;
  let isNetworkDone = false;
  let networkError: Error | null = null;

  let residue = Buffer.alloc(0);
  let currentFileController: {
    enqueue: (c: Uint8Array) => void;
    close: () => void;
  } | null = null;
  let searchingForFirstBoundary = true;
  let inHeaderSection = false;
  let activePartMeta: {
    name?: string;
    filename?: string;
    contentType?: string;
  } | null = null;

  // Process incoming network data completely out-of-band
  const processChunk = (chunk: Buffer) => {
    residue = Buffer.concat([residue, chunk]);

    while (residue.length >= boundaryLength) {
      if (inHeaderSection) {
        const headerEndIndex = residue.indexOf("\r\n\r\n");
        if (headerEndIndex === -1) break;

        const headersString = residue
          .subarray(0, headerEndIndex)
          .toString("utf8");
        residue = residue.subarray(headerEndIndex + 4);
        inHeaderSection = false;

        if (
          headersString.toLowerCase().includes("content-disposition: form-data")
        ) {
          const nameMatch = headersString.match(/name="([^"]+)"/i);
          const filenameMatch = headersString.match(/filename="([^"]+)"/i);
          const contentTypeMatch = headersString.match(
            /Content-Type:\s*([^\r\n;]+)/i,
          );

          activePartMeta = {
            name: nameMatch ? nameMatch[1] : "",
            filename: filenameMatch ? filenameMatch[1] : undefined,
            contentType: contentTypeMatch
              ? contentTypeMatch[1].trim()
              : undefined,
          };

          if (activePartMeta.filename) {
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
                chunks.push(chunk);
              }
              return Buffer.concat(chunks);
            };

            partQueue.push({
              isFile: true,
              name: activePartMeta.name!,
              filename: activePartMeta.filename,
              contentType: activePartMeta.contentType,
              stream: nodeCompatibleStream,
              save: saveMethod,
              buffer: bufferMethod,
              text: async () => (await bufferMethod()).toString("utf8"),
            });

            if (resolveNextPart) {
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
          const streamablePart = residue.subarray(
            0,
            residue.length - safeKeepLength,
          );
          if (currentFileController) {
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

        if (currentFileController) {
          currentFileController.enqueue(
            new Uint8Array(
              exactDataBlock.buffer,
              exactDataBlock.byteOffset,
              exactDataBlock.byteLength,
            ),
          );
          currentFileController.close();
          currentFileController = null;
        } else if (activePartMeta && !activePartMeta.filename) {
          partQueue.push({
            isFile: false,
            name: activePartMeta.name!,
            value: exactDataBlock.toString("utf8"),
          });

          if (resolveNextPart) {
            resolveNextPart();
            resolveNextPart = null;
          }
        }
      }

      if (residue.indexOf(endBoundaryBuffer) === index) {
        if (currentFileController) {
          currentFileController.close();
          currentFileController = null;
        }
        isNetworkDone = true;
        if (resolveNextPart) {
          resolveNextPart();
          resolveNextPart = null;
        }
        return;
      }

      if (currentFileController) {
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

  // Bind direct event listeners to control data stream absorption independently
  req.on("data", (chunk: Buffer) => {
    try {
      processChunk(chunk);
    } catch (err) {
      networkError = err as Error;
      if (resolveNextPart) resolveNextPart();
    }
  });

  req.on("end", () => {
    if (currentFileController) {
      currentFileController.close();
    }
    isNetworkDone = true;
    if (resolveNextPart) resolveNextPart();
  });

  req.on("error", (err) => {
    networkError = err;
    if (resolveNextPart) resolveNextPart();
  });

  // Yield fields from our decoupled buffer queue
  while (true) {
    if (networkError) throw networkError;

    if (partQueue.length > 0) {
      yield partQueue.shift()!;
      continue;
    }

    if (isNetworkDone) break;

    await new Promise<void>((resolve) => {
      resolveNextPart = resolve;
    });
  }
}
