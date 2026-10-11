import * as http from "http";
import { Readable } from "stream";
import type {
  Query,
  PathData,
  JSONResponseOptions,
  SendFileOptions,
  ErrorHandler,
  CookieOptions,
  MultipartPart,
  ExtractParams,
} from "../core/types.ts";
import { App } from "../core/server.ts";
import { parseUrl, parseQuery } from "./parseUrl.ts";
import { createCompiledStringifier } from "./stringifyJson.ts";
import { isFileInFolder, openContainedFile } from "./security.ts";
import type { OpenedFile } from "./security.ts";
import {
  MethodNotAllowedError,
  SendAfterSentError,
  HeadersSentError,
  NotFoundError,
  VoltenError,
  BadRequestError,
  UnsupportedMediaTypeError,
  PayloadTooLargeError,
} from "../core/errors.ts";
import { getMimeType } from "./mime.ts";
import {
  contentDispositionAttachment,
  extractMediaType,
  ifNoneMatchMatches,
  isJsonMediaType,
  isSetCookieHeaderName,
  isUrlEncodedMediaType,
  parseCookieHeader,
  serializeSetCookie,
  shouldSendContent,
} from "./httpRfc.ts";

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

export class ContextStorage {
  public static readonly BUFFER_SIZE = 64 * 1024;
  public responseBuffer: Buffer = Buffer.allocUnsafe(ContextStorage.BUFFER_SIZE);
  public bufferOffset: number = 0;
  public isFlushing: boolean = false;
  public writeQueue: { str: string; resolve: () => void }[] = [];
  public activeToken: number = 0;
  public generation: number = 0;

  public reset(): void {
    this.activeToken = 0;
    this.generation++;
    this.bufferOffset = 0;
    this.isFlushing = false;
    if (this.writeQueue.length > 0) {
      this.writeQueue = [];
    }
  }
}

export class NodeContextStorage extends ContextStorage {}

export class EdgeContextStorage extends ContextStorage {}

let nextContextToken = 1;

export class RequestContext<P extends string = string> {
  public static readonly BUFFER_SIZE = 64 * 1024;
  public readonly token: number;
  public readonly _storage: ContextStorage;

  /** True once the underlying connection/response has closed. The context is NOT recycled until handler execution also settles. */
  public disconnected: boolean = false;

  public get generation(): number {
    return this._storage.generation;
  }
  public set generation(val: number) {
    this._storage.generation = val;
  }
  public reqGeneration: number = 0;

  public get isValid(): boolean {
    return !this.disconnected && this.token !== 0 && this.token === this._storage.activeToken;
  }

  public invalidate(): void {
    this.disconnected = true;
    this._res = null;
    this._req = null;
    this._headers = null;
    this._params = null;
    this._state = null;
    this.queryValue = null;
    this._cookiesCache = null;
  }

  public _app: App<string> | null = null;
  public _req: http.IncomingMessage | Request | null = null;
  public _res: http.ServerResponse | null = null;
  public _route: PathData | null = null;

  constructor(storage?: ContextStorage, token?: number) {
    if (storage !== undefined) {
      this._storage = storage;
      this.token = token ?? (storage.activeToken !== 0 ? storage.activeToken : ++nextContextToken);
      if (storage.activeToken === 0) {
        storage.activeToken = this.token;
      }
    } else {
      this._storage = new ContextStorage();
      this.token = ++nextContextToken;
      this._storage.activeToken = this.token;
    }
    this.reqGeneration = this._storage.generation;
  }

  private _ensureParsedUrl(): void {
    if (this._path !== null) return;
    const url = this.url;
    if (
      url.charCodeAt(0) === 47 &&
      url.charCodeAt(1) !== 47 &&
      url.indexOf("\0") === -1 &&
      url.indexOf("#") === -1
    ) {
      const qIdx = url.indexOf("?");
      if (qIdx === -1) {
        this._path = url;
        this._queryString = "";
      } else {
        this._path = qIdx > 0 ? url.slice(0, qIdx) : "/";
        this._queryString = url.substring(qIdx + 1);
      }
      return;
    }
    const { pathname, queryStr } = parseUrl(url);
    this._path = pathname;
    this._queryString = queryStr;
  }

  get path(): string {
    if (!this.isValid) return "";
    this._ensureParsedUrl();
    return this._path ?? "";
  }

  get queryString(): string {
    if (!this.isValid) return "";
    this._ensureParsedUrl();
    return this._queryString ?? "";
  }

  public method!: string;
  public url!: string;
  public _path: string | null = null;
  public _queryString: string | null = null;
  public _headers: http.IncomingHttpHeaders | Record<string, string | string[] | undefined> | null =
    null;
  protected _state: Record<string, unknown> | null = null;
  get state(): Record<string, unknown> {
    if (!this.isValid) return {};
    return (this._state ??= {});
  }
  set state(val: Record<string, unknown>) {
    if (!this.isValid) throw new Error("Context expired");
    this._state = val;
  }
  protected _params: ExtractParams<P> | null = null;
  get params(): ExtractParams<P> {
    if (!this.isValid) return Object.create(null) as ExtractParams<P>;
    return (this._params ??= Object.create(null) as ExtractParams<P>);
  }
  set params(val: ExtractParams<P>) {
    if (!this.isValid) throw new Error("Context expired");
    this._params = val;
  }
  public inited: boolean = false;

  protected queryValue: Query | null = null;
  public _bodyPromise?: Promise<unknown> | undefined;
  public JSONOptions?: JSONResponseOptions;

  public env: unknown = null;
  public executionCtx: unknown = null;
  public runtime: "node" | "edge" = "node";

  get responseBuffer(): Buffer {
    return this._storage.responseBuffer;
  }
  set responseBuffer(val: Buffer) {
    this._storage.responseBuffer = val;
  }

  get bufferOffset(): number {
    return this._storage.bufferOffset;
  }
  set bufferOffset(val: number) {
    this._storage.bufferOffset = val;
  }

  get isFlushing(): boolean {
    return this._storage.isFlushing;
  }
  set isFlushing(val: boolean) {
    this._storage.isFlushing = val;
  }

  get writeQueue(): { str: string; resolve: () => void }[] {
    return this._storage.writeQueue;
  }
  set writeQueue(val: { str: string; resolve: () => void }[]) {
    this._storage.writeQueue = val;
  }

  protected _cookiesCache: Record<string, string> | null = null;

  protected logWarn(message: string, ...args: unknown[]): void {
    if (this._app !== null) {
      this._app.logger.warn(message, ...args);
    }
  }

  protected logError(message: string, ...args: unknown[]): void {
    if (this._app !== null) {
      this._app.logger.error(message, ...args);
    }
  }

  public init(
    app: App<string>,
    req: http.IncomingMessage | Request,
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    resOrEnv?: http.ServerResponse | unknown,
    _executionCtx?: unknown,
  ): void {
    const storage = this._storage;
    if (storage.activeToken === 0) {
      storage.activeToken = this.token;
    } else if (storage.activeToken !== this.token) {
      throw new Error("Context expired");
    }
    const reqNode = req as http.IncomingMessage;
    const resNode = resOrEnv as http.ServerResponse | undefined;

    this.reqGeneration = storage.generation;
    this._app = app;
    this._req = reqNode;
    this._res = resNode !== undefined ? resNode : null;

    this.url = reqNode.url ?? "/";
    this._path = null;
    this._queryString = null;

    this.queryValue = null;
    this._params = null;
    this._state = null;
    this._cookiesCache = null;
    this._headers = reqNode.headers;
    this.method = reqNode.method ?? "GET";

    this._bodyPromise = undefined;
    storage.bufferOffset = 0;
    this.inited = true;
  }

  get route(): PathData {
    if (this._route === null) throw new Error("Route not initialized");
    return this._route;
  }

  get req(): http.IncomingMessage | Request {
    if (!this.isValid) throw new Error("Context expired");
    if (this._req === null) throw new Error("Request not initialized");
    return this._req;
  }

  get res(): http.ServerResponse | null {
    if (!this.isValid) return null;
    return this._res;
  }

  get rawReq(): http.IncomingMessage | Request {
    return this.req;
  }

  get rawRes(): http.ServerResponse | null {
    return this.res;
  }

  get headersSent(): boolean {
    return this._res === null ? false : this._res.headersSent;
  }

  get sent(): boolean {
    return this._res === null ? true : this._res.writableEnded;
  }

  get statusCode(): number {
    return this._res === null ? 200 : this._res.statusCode;
  }

  set statusCode(code: number) {
    if (!this.isValid) return;
    if (this._res !== null) {
      this._res.statusCode = code;
    }
  }

  get type(): string {
    if (this._res === null) return "";
    const type = this._res.getHeader("Content-Type");
    return typeof type === "string" ? (type.split(";")[0] ?? "") : "";
  }

  set type(value: string) {
    this.setHeader("Content-Type", value);
  }

  get ip(): string {
    const xForwardedFor = this.headers["x-forwarded-for"];
    if (xForwardedFor !== undefined) {
      const commaIndex = typeof xForwardedFor === "string" ? xForwardedFor.indexOf(",") : -1;
      return commaIndex === -1
        ? (xForwardedFor as string).trim()
        : (xForwardedFor as string).substring(0, commaIndex).trim();
    }

    const cfIp = this.headers["cf-connecting-ip"];
    if (cfIp !== undefined && typeof cfIp === "string") {
      return cfIp.trim();
    }
    const reqNode = this._req as http.IncomingMessage | null;
    return reqNode?.socket.remoteAddress ?? "";
  }

  get hostname(): string {
    const host = this.headers["x-forwarded-host"] ?? this.headers["host"];
    if (host === undefined || typeof host !== "string") return "";

    const firstHost = host.includes(",") ? (host.split(",")[0] ?? "").trim() : host;
    const portIndex = firstHost.lastIndexOf(":");
    const bracketIndex = firstHost.indexOf("]");

    if (portIndex !== -1 && portIndex > bracketIndex) {
      return firstHost.substring(0, portIndex);
    }
    return firstHost;
  }

  get host(): string {
    const host = this.headers["x-forwarded-host"] ?? this.headers["host"];
    if (host === undefined || typeof host !== "string") return "";
    return host.includes(",") ? (host.split(",")[0] ?? "").trim() : host;
  }

  get isMultipart(): boolean {
    const contentType = this.headers["content-type"];
    if (contentType === undefined || typeof contentType !== "string") return false;
    return contentType.includes("multipart/form-data");
  }

  get headers(): Record<string, string | string[] | undefined> {
    if (!this.isValid) return {};
    return this._headers ?? {};
  }

  get app(): App<string> {
    if (this._app === null) throw new Error("App not initialized");
    return this._app;
  }

  get query(): Query {
    if (!this.isValid) return {};
    if (this.queryValue === null) {
      this.queryValue = parseQuery(this.queryString);
    }
    return this.queryValue;
  }

  public status(code: number): this {
    if (!this.isValid) return this;
    this.statusCode = code;
    return this;
  }

  public download(
    filePath: string,
    fileName: string,
    statusCode: number = this.statusCode,
    errCallback?: ErrorHandler,
  ): Promise<this> {
    const options: SendFileOptions = {
      download: fileName,
    };
    if (errCallback !== undefined) options.errCallback = errCallback;
    return this.sendFile(filePath, statusCode, options);
  }

  public async handleRouteFallback(): Promise<void> {
    const app = this.app;
    const pathname = this.path;
    const staticPath = app.serverStaticMap;
    if (
      staticPath !== null &&
      (this.method === "GET" || this.method === "HEAD" || this.method === "OPTIONS")
    ) {
      const pathModule = await import("path");
      let decoded: string | null;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        decoded = null;
      }
      if (decoded !== null && !decoded.includes("\0")) {
        // Resolve against an absolute root so containment checks never depend on cwd-relative joins.
        const absRoot = pathModule.resolve(staticPath);
        const relative = decoded.replace(/^[/\\]+/, "");
        if (this.method === "OPTIONS") {
          if (await isFileInFolder(absRoot, pathModule.join(absRoot, relative))) {
            this.statusCode = 204;
            this.setHeader("Allow", "GET, HEAD, OPTIONS");
            this.send();
            return;
          }
        } else {
          try {
            await this.sendFile(relative, 200, { root: absRoot });
            return;
          } catch (err) {
            if (!(err instanceof NotFoundError)) throw err;
          }
        }
      }
    }

    const routeTree = app.getRouteTree();
    const methodsAllowed = routeTree.checkMethodAllowed(pathname);
    if (this.method === "OPTIONS" && methodsAllowed.length > 0) {
      this.statusCode = 204;
      this.setHeader("Allow", methodsAllowed.join(", "));
      this.setHeader("Content-Length", 0);
      this.send();
      return;
    }
    if (methodsAllowed.length > 0) {
      throw new MethodNotAllowedError(this.method, methodsAllowed);
    }

    throw new NotFoundError("Route Not Found");
  }

  public routePath(): void | Promise<void> {
    if (!this.inited) return;
    const app = this.app;
    const route = app.getRoute(this.method, this.path, this);
    if (route !== null) {
      this._route = route;
      return;
    }
    return this.handleRouteFallback();
  }

  reset() {
    this._storage.reset();
    this.disconnected = false;
    this.inited = false;
    this._app = null;
    this._req = null;
    this._res = null;
    this._route = null;
    this._headers = null;
    this._params = null;
    this._state = null;
    this.queryValue = null;
    this._bodyPromise = undefined;
    this._cookiesCache = null;
    this.env = null;
    this.executionCtx = null;
  }

  public async flush(): Promise<void> {
    const resObj = this.res;
    if (resObj === null) return;
    if ((this.bufferOffset === 0 && this.writeQueue.length === 0) || this.isFlushing) return;
    try {
      this.isFlushing = true;
      if (this.bufferOffset > 0) {
        const chunk = Buffer.from(this.responseBuffer.subarray(0, this.bufferOffset));
        this.bufferOffset = 0;
        const ready = resObj.write(chunk);
        if (!ready) {
          await new Promise<void>((resolve) => resObj.once("drain", resolve));
        }
      }

      while (this.writeQueue.length > 0) {
        const next = this.writeQueue.shift();
        if (next === undefined) break;
        const len = Buffer.byteLength(next.str);

        if (len >= RequestContext.BUFFER_SIZE) {
          if (this.bufferOffset > 0) {
            const chunk = Buffer.from(this.responseBuffer.subarray(0, this.bufferOffset));
            this.bufferOffset = 0;
            const ready = resObj.write(chunk);
            if (!ready) {
              await new Promise<void>((resolve) => resObj.once("drain", resolve));
            }
          }
          const ready = resObj.write(next.str);
          if (!ready) {
            await new Promise<void>((resolve) => resObj.once("drain", resolve));
          }
          next.resolve();
          continue;
        }

        if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
          const chunk = Buffer.from(this.responseBuffer.subarray(0, this.bufferOffset));
          this.bufferOffset = 0;

          const ready = resObj.write(chunk);
          if (!ready) {
            await new Promise<void>((resolve) => resObj.once("drain", resolve));
          }
        }

        this.bufferOffset += this.responseBuffer.write(next.str, this.bufferOffset);
        next.resolve();
      }
    } finally {
      this.isFlushing = false;
    }
  }

  public async writeStatic(str: string): Promise<void> {
    if (!this.isValid) return;
    if (this.isFlushing) {
      return new Promise((resolve) => {
        this.writeQueue.push({ str, resolve });
      });
    }

    const len = Buffer.byteLength(str);

    if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
      await this.flush();
    }

    if (len > RequestContext.BUFFER_SIZE) {
      const resObj = this.res;
      if (resObj === null) return;
      this.isFlushing = true;
      try {
        const ready = resObj.write(str);
        if (!ready) {
          await new Promise<void>((resolve) => resObj.once("drain", resolve));
        }
      } finally {
        this.isFlushing = false;
        if (this.writeQueue.length > 0) {
          await this.flush();
        }
      }
      return;
    }

    this.bufferOffset += this.responseBuffer.write(str, this.bufferOffset);
  }

  public json(data: unknown, statusCode: number = this.statusCode): this {
    const resObj = this.res;
    if (resObj === null) return this;
    resObj.statusCode = statusCode;

    if (resObj.writableEnded) {
      throw new SendAfterSentError("json");
    }

    const body = JSON.stringify(data);
    if (!resObj.headersSent) resObj.cork();
    resObj.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    this.endNodePayload(resObj, body);
    return this;
  }

  public text(data: string, statusCode: number = this.statusCode): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (resObj.writableEnded) {
      throw new SendAfterSentError("text");
    }
    resObj.statusCode = statusCode;
    if (!resObj.headersSent) {
      resObj.setHeader("Content-Type", "text/plain; charset=utf-8");
    } else {
      this.logWarn("Headers Already Sent, Sending Only Body");
    }
    this.endNodePayload(resObj, data);
    return this;
  }

  public buffer(data: Buffer, statusCode: number = this.statusCode): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (resObj.writableEnded) {
      throw new SendAfterSentError("buffer");
    }
    resObj.statusCode = statusCode;
    if (resObj.headersSent) {
      throw new HeadersSentError();
    }
    resObj.setHeader("Content-Type", "application/octet-stream");
    this.endNodePayload(resObj, data);
    return this;
  }

  public send(data?: unknown, statusCode: number = this.statusCode): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (data === undefined) {
      resObj.statusCode = statusCode;
      this.endNodePayload(resObj, null);
      return this;
    }
    resObj.cork();
    if (typeof data === "string") {
      this.text(data, statusCode);
    } else if (Buffer.isBuffer(data)) {
      this.buffer(data, statusCode);
    } else {
      this.json(data, statusCode);
    }
    return this;
  }

  protected endNodePayload(resObj: http.ServerResponse, body: string | Buffer | null): void {
    let pendingChunk: Buffer | null = null;
    const storage = this._storage;
    if (storage.bufferOffset > 0) {
      pendingChunk = Buffer.from(storage.responseBuffer.subarray(0, storage.bufferOffset));
      storage.bufferOffset = 0;
    }

    const status = resObj.statusCode;
    const payloadLength =
      body === null ? 0 : Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);

    if (this.method === "HEAD") {
      if (!resObj.headersSent) {
        resObj.setHeader("Content-Length", payloadLength);
      }
      resObj.end();
      resObj.uncork();
      return;
    }

    if (!shouldSendContent(this.method, status)) {
      if (!resObj.headersSent) {
        if (status === 204) {
          resObj.removeHeader("Content-Length");
          resObj.removeHeader("Content-Type");
        } else if (status === 304) {
          // RFC 9110: 304 must not force Content-Length: 0. Preserve representation length if known.
          if (resObj.getHeader("Content-Length") === undefined && payloadLength > 0) {
            resObj.setHeader("Content-Length", payloadLength);
          }
        } else {
          resObj.setHeader("Content-Length", 0);
        }
      }
      resObj.end();
      resObj.uncork();
      return;
    }

    if (body === null) {
      if (pendingChunk !== null) resObj.end(pendingChunk);
      else resObj.end();
      resObj.uncork();
      return;
    }

    if (!resObj.headersSent) {
      // Note: If there's a pending chunk, we can't accurately set Content-Length here unless we add it
      if (pendingChunk !== null) {
        resObj.setHeader("Content-Length", payloadLength + pendingChunk.length);
      } else {
        resObj.setHeader("Content-Length", payloadLength);
      }
    }
    if (pendingChunk !== null) resObj.write(pendingChunk);
    resObj.end(body);
    resObj.uncork();
  }

  public getHeaders(): http.OutgoingHttpHeaders {
    const resObj = this.res;
    return resObj !== null ? resObj.getHeaders() : {};
  }

  public getHeader(header: string): string | undefined {
    const resObj = this.res;
    if (resObj === null) return undefined;
    const raw = resObj.getHeader(header);
    if (raw === undefined) return undefined;
    if (Array.isArray(raw)) {
      if (isSetCookieHeaderName(header)) {
        const first = raw[0];
        return first === undefined ? undefined : first;
      }
      return raw.join(", ");
    }
    return String(raw);
  }

  public getRawHeader(header: string): string | number | string[] | null | undefined {
    const resObj = this.res;
    return resObj !== null ? resObj.getHeader(header) : undefined;
  }

  public setHeader(key: string, value: string | number | readonly string[]): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (resObj.headersSent) {
      throw new HeadersSentError();
    }
    resObj.setHeader(key, value);
    return this;
  }

  removeHeader(key: string): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (resObj.headersSent) {
      throw new HeadersSentError();
    }
    resObj.removeHeader(key);
    return this;
  }

  flushHeaders(): this {
    const resObj = this.res;
    if (resObj === null) return this;
    if (resObj.headersSent) {
      throw new HeadersSentError();
    }
    resObj.flushHeaders();
    return this;
  }

  get cookies(): Record<string, string> {
    if (!this.isValid) return {};
    if (this._cookiesCache !== null) {
      return this._cookiesCache;
    }
    const rawCookieHeader = this.headers["cookie"];
    if (
      rawCookieHeader === undefined ||
      rawCookieHeader.length === 0 ||
      typeof rawCookieHeader !== "string"
    ) {
      this._cookiesCache = Object.freeze({});
      return this._cookiesCache;
    }
    const parsedCookies = parseCookieHeader(rawCookieHeader);
    this._cookiesCache = parsedCookies;
    return this._cookiesCache;
  }

  public setCookie(name: string, value: string, options: CookieOptions = {}): this {
    const resObj = this.res;
    if (resObj === null) return this;
    const str = serializeSetCookie(name, value, options);
    const existing = resObj.getHeader("Set-Cookie");

    if (existing === undefined) {
      this.setHeader("Set-Cookie", str);
    } else if (typeof existing === "string") {
      this.setHeader("Set-Cookie", [existing, str]);
    } else if (Array.isArray(existing)) {
      this.setHeader("Set-Cookie", [...existing, str]);
    }
    return this;
  }

  public clearCookie(name: string, options: Omit<CookieOptions, "maxAge" | "expires"> = {}): this {
    if (!this.isValid) return this;

    return this.setCookie(name, "", {
      ...options,
      expires: new Date(0),
    });
  }

  get bodyStream(): ReadableStream<Uint8Array> {
    return Readable.toWeb(this.req as http.IncomingMessage) as ReadableStream<Uint8Array>;
  }

  public body(type: "json" | "text" = "json"): Promise<unknown> {
    if (!this.isValid) return Promise.reject(new Error("Context expired"));
    if (this._bodyPromise !== undefined) return this._bodyPromise;

    if (this.isMultipart) {
      this._bodyPromise = Promise.reject(
        new Error(
          "Volten: Cannot parse multipart/form-data via ctx.body(). Use ctx.multipart() instead to stream binary components safely.",
        ),
      );
      return this._bodyPromise;
    }

    if (["POST", "PUT", "PATCH"].includes(this.method)) {
      this._bodyPromise = this.app.parseBody.call(this.app, this, type === "text");
    } else {
      this.logWarn(
        `Attempted to access body on a ${this.method} request; returning empty fallback.`,
      );
      this._bodyPromise = Promise.resolve(type === "text" ? "" : {});
    }

    return this._bodyPromise;
  }

  public async *multipart(): AsyncGenerator<MultipartPart, void, unknown> {
    if (!this.isValid) return;
    if (!this.isMultipart) {
      this.logWarn("Attempted to call ctx.multipart() on a non-multipart request header.");
      return;
    }

    yield* this.app.parseMultipartStream.call(this.app, this);
  }

  public async sendFile(
    filePath: string,
    statusCode: number = this.statusCode,
    options?: SendFileOptions,
  ): Promise<this> {
    if (!this.isValid) return this;
    const resObj = this.res;
    if (resObj === null) return this;
    if (this.sent) {
      this.logWarn("Attempted to send file after response was sent");
      return this;
    }
    const gen = this.generation;
    let opened: OpenedFile | null = null;
    let streaming = false;
    try {
      const pathModule = await import("path");
      const fsModule = await import("fs");
      if (options?.root !== undefined) {
        // Root-confined mode: open-then-validate (see openContainedFile).
        opened = await openContainedFile(options.root, filePath);
        if (opened === null) {
          const error = new NotFoundError("Resource Not Found");
          if (options.errCallback !== undefined) {
            void options.errCallback(error, this);
          }
          throw error;
        }
      } else if (!pathModule.isAbsolute(filePath)) {
        throw new BadRequestError("path must be absolute or specify root to res.sendFile");
      } else {
        // Trusted mode: caller vouches for the path. Still fstat the opened descriptor so
        // the type/size we advertise belong to the object we actually stream.
        const handle = await fsModule.promises.open(filePath, "r");
        const st = await handle.stat();
        if (!st.isFile()) {
          await handle.close();
          const error = new NotFoundError("Resource Not Found");
          if (options?.errCallback !== undefined) {
            void options.errCallback(error, this);
          }
          throw error;
        }
        opened = { handle, stats: st, realPath: filePath };
      }

      if (this.generation !== gen || this.disconnected) {
        return this;
      }
      const stats = opened.stats;
      const ext = pathModule.extname(opened.realPath).toLowerCase().slice(1);
      const contentType = getMimeType(ext);

      const mtimeStr = stats.mtime.getTime().toString(16);
      const sizeStr = stats.size.toString(16);
      const etag = `W/"${sizeStr}-${mtimeStr}"`;

      const reqHeaders = this.headers;
      const ifNoneMatch = reqHeaders["if-none-match"];
      const ifModifiedSince = reqHeaders["if-modified-since"];

      let is304 = false;
      if (ifNoneMatchMatches(ifNoneMatch, etag)) {
        is304 = true;
      } else if (ifNoneMatch === undefined && typeof ifModifiedSince === "string") {
        const modifiedSince = new Date(ifModifiedSince);
        if (!isNaN(modifiedSince.getTime()) && modifiedSince >= stats.mtime) {
          is304 = true;
        }
      }

      if (is304) {
        resObj.statusCode = 304;
        this.setHeader("ETag", etag);
        this.setHeader("Last-Modified", stats.mtime.toUTCString());
        resObj.end();
        return this;
      }

      resObj.cork();
      try {
        resObj.statusCode = statusCode;
        this.setHeader("Content-Type", contentType);
        this.setHeader("X-Content-Type-Options", "nosniff");
        this.setHeader("Content-Length", stats.size);
        this.setHeader("Last-Modified", stats.mtime.toUTCString());
        this.setHeader("ETag", etag);

        if (options?.download !== undefined) {
          this.setHeader("Content-Disposition", contentDispositionAttachment(options.download));
        }
      } finally {
        resObj.uncork();
      }

      if (!shouldSendContent(this.method, resObj.statusCode)) {
        resObj.end();
        return this;
      }

      const stream = opened.handle.createReadStream({ autoClose: true });
      streaming = true;
      const app = this.app;
      stream.pipe(resObj);

      resObj.once("close", () => {
        stream.destroy();
      });

      stream.on("error", (streamErr) => {
        this.logError("Stream error:", streamErr);
        stream.destroy();
        const normalizedErr = VoltenError.from(streamErr);

        if (options?.errCallback !== undefined) {
          void options.errCallback(normalizedErr, this);
        }
        // The context is only recycled after the response closes, but guard anyway.
        if (this.generation === gen) {
          void app.handleError(normalizedErr, this);
        }
      });
    } catch {
      const error = new NotFoundError("Resource Not Found");
      if (options?.errCallback !== undefined) {
        void options.errCallback(error, this);
      }
      throw error;
    } finally {
      if (opened !== null && !streaming) {
        try {
          await opened.handle.close();
        } catch {
          /* already closed */
        }
      }
    }

    return this;
  }
}

export class NodeRequestContext<P extends string = string> extends RequestContext<P> {
  constructor(storage?: NodeContextStorage, token?: number) {
    super(storage ?? new NodeContextStorage(), token);
  }
}

export class EdgeRequestContext<P extends string = string> extends RequestContext<P> {
  public override readonly runtime = "edge";
  public _edgeReq: Request | null = null;
  public _edgeStatus: number = 200;
  public _edgeHeaders: Headers = new Headers();
  public _edgeBody: unknown = null;
  public _edgeBodySent: boolean = false;
  private _webStream: ReadableStream<Uint8Array> | null = null;

  public _resolveEdgeResponse!: (res: Response) => void;
  public _edgeResponsePromise!: Promise<Response>;

  constructor(storage?: EdgeContextStorage, token?: number) {
    super(storage ?? new EdgeContextStorage(), token);
  }

  public override init(
    app: App<string>,
    req: http.IncomingMessage | Request,
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    resOrEnv?: http.ServerResponse | unknown,
    executionCtx?: unknown,
  ): void {
    if (this._storage.activeToken === 0) {
      this._storage.activeToken = this.token;
    }
    if (this._storage.activeToken !== this.token) {
      throw new Error("Context expired");
    }
    this.reqGeneration = this.generation;
    this._app = app;
    const edgeReq = req as Request;
    this._edgeReq = edgeReq;
    this.env = resOrEnv;
    this.executionCtx = executionCtx;
    this._edgeStatus = 200;
    this._edgeHeaders = new Headers();
    this._edgeBody = null;
    this._edgeBodySent = false;
    this._route = null;
    this._cookiesCache = null;
    this._webStream = null;

    this._edgeResponsePromise = new Promise<Response>((resolve) => {
      this._resolveEdgeResponse = resolve;
    });

    const urlStr = edgeReq.url;
    let relativeUrl = urlStr;
    try {
      const parsedUrl = new URL(urlStr);
      relativeUrl = parsedUrl.pathname + parsedUrl.search;
    } catch {
      // relative
    }
    this.url = relativeUrl;
    this._path = null;
    this._queryString = null;
    this.queryValue = null;
    this._params = null;
    this._state = null;

    const headersObj: Record<string, string> = {};
    edgeReq.headers.forEach((val: string, key: string) => {
      headersObj[key] = val;
    });
    this._headers = headersObj;
    this.method = edgeReq.method;
    this.inited = true;
  }

  override get req(): Request {
    if (!this.isValid) throw new Error("Context expired");
    if (this._edgeReq === null) throw new Error("Request not initialized");
    return this._edgeReq;
  }

  override get res(): null {
    return null;
  }

  override get rawReq(): Request {
    return this.req;
  }

  override get rawRes(): null {
    return null;
  }

  override get headersSent(): boolean {
    return this._edgeBodySent;
  }

  override get sent(): boolean {
    return this._edgeBodySent;
  }

  override get statusCode(): number {
    return this._edgeStatus;
  }

  override set statusCode(code: number) {
    if (!this.isValid || this._edgeBodySent) return;
    this._edgeStatus = code;
  }

  override get type(): string {
    const type = this._edgeHeaders.get("Content-Type");
    return type !== null ? (type.split(";")[0] ?? "") : "";
  }

  override set type(value: string) {
    if (!this.isValid || this._edgeBodySent) return;
    this._edgeHeaders.set("Content-Type", value);
  }

  override get ip(): string {
    const xForwardedFor = this.headers["x-forwarded-for"];
    if (xForwardedFor !== undefined) {
      const commaIndex = typeof xForwardedFor === "string" ? xForwardedFor.indexOf(",") : -1;
      return commaIndex === -1
        ? (xForwardedFor as string).trim()
        : (xForwardedFor as string).substring(0, commaIndex).trim();
    }

    const cfIp = this.headers["cf-connecting-ip"];
    if (cfIp !== undefined && typeof cfIp === "string") {
      return cfIp.trim();
    }
    return "";
  }

  override get isMultipart(): boolean {
    const contentType = this.headers["content-type"];
    if (contentType === undefined || typeof contentType !== "string") return false;
    return contentType.includes("multipart/form-data");
  }

  override get headers(): Record<string, string | string[] | undefined> {
    if (!this.isValid) return {};
    return this._headers ?? {};
  }

  override reset() {
    super.reset();
    this._edgeReq = null;
    this._edgeStatus = 200;
    this._edgeHeaders = new Headers();
    this._edgeBody = null;
    this._edgeBodySent = false;
    this._edgeTransformWriter = null;
    this._webStream = null;
  }

  override invalidate(): void {
    super.invalidate();
    this._edgeReq = null;
    this._edgeBody = null;
    this._webStream = null;
  }

  override async flush(): Promise<void> {}

  private _edgeTransformWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;

  override async writeStatic(str: string): Promise<void> {
    if (!this.isValid || this._edgeBodySent) return;
    if (this._edgeBody === null || typeof this._edgeBody === "string") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const previousBody = this._edgeBody;
      this._edgeBody = readable;
      if (typeof previousBody === "string" && previousBody.length > 0) {
        await writer.write(new TextEncoder().encode(previousBody));
      }
      this._edgeTransformWriter = writer;
    }
    if (this._edgeTransformWriter !== null) {
      await this._edgeTransformWriter.write(new TextEncoder().encode(str));
    }
  }

  private endEdgePayload(body: string | Buffer | Uint8Array | null): void {
    if (this._edgeTransformWriter !== null) {
      void this._edgeTransformWriter.close();
      this._edgeTransformWriter = null;
    }
    const status = this._edgeStatus;
    const payloadLength =
      body === null ? 0 : typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;

    if (this.method === "HEAD") {
      this._edgeHeaders.set("Content-Length", String(payloadLength));
      if (this._edgeBody instanceof ReadableStream) {
        this._edgeBody.cancel().catch(() => {});
      }
      this._edgeBody = null;
      this._edgeBodySent = true;
      this._resolveEdgeResponse(new Response(null, { status, headers: this._edgeHeaders }));
      return;
    }

    if (!shouldSendContent(this.method, status)) {
      if (this._edgeBody instanceof ReadableStream) {
        this._edgeBody.cancel().catch(() => {});
      }
      if (status === 204) {
        this._edgeHeaders.delete("Content-Length");
        this._edgeHeaders.delete("Content-Type");
      } else if (status === 304) {
        if (!this._edgeHeaders.has("Content-Length") && payloadLength > 0) {
          this._edgeHeaders.set("Content-Length", String(payloadLength));
        }
      } else {
        this._edgeHeaders.set("Content-Length", "0");
      }
      this._edgeBody = null;
      this._edgeBodySent = true;
      this._resolveEdgeResponse(new Response(null, { status, headers: this._edgeHeaders }));
      return;
    }

    const finalBody = body !== null ? body : this._edgeBody;
    this._edgeBody = finalBody;
    let wrappedBody = finalBody as BodyInit;
    if (finalBody instanceof ReadableStream) {
      const appRef = this._app;
      const reader = finalBody.getReader();
      wrappedBody = new ReadableStream({
        pull: async (controller) => {
          try {
            const res = await reader.read();
            if (res.done) {
              controller.close();
            } else {
              controller.enqueue(res.value);
            }
          } catch (err) {
            controller.error(err);
            if (appRef !== null && !this._edgeBodySent) {
              // Fallback triggered
              void appRef.handleError(err, this);
            } else if (appRef !== null) {
              // Headers sent, just run error handler
              void appRef.handleError(err, this);
            }
          }
        },
        cancel(reason) {
          reader.cancel(reason).catch(() => {});
        },
      });
    }
    this._edgeBodySent = true;
    this._resolveEdgeResponse(new Response(wrappedBody, { status, headers: this._edgeHeaders }));
  }

  override json(data: unknown, statusCode: number = this._edgeStatus): this {
    if (!this.isValid || this._edgeBodySent) return this;
    this._edgeStatus = statusCode;
    this._edgeHeaders.set("Content-Type", "application/json; charset=utf-8");
    this._edgeHeaders.set("Server", "Volten/1.0.0");

    let body: string;
    if (this._route === null || this.route.disableOpt) {
      body = JSON.stringify(data);
    } else {
      try {
        let serializer = this.route.serializer;
        if (serializer === undefined) {
          const finger = this.app.JITCache.getShapeFingerprint(data);
          serializer = this.app.JITCache.get(finger);
          if (serializer === undefined) {
            serializer = createCompiledStringifier(data);
            this.app.JITCache.set(finger, serializer);
          }
          this.route.serializer = serializer;
        }
        body = serializer(data);
      } catch {
        body = JSON.stringify(data);
      }
    }
    this.endEdgePayload(body);
    return this;
  }

  override text(data: string, statusCode: number = this._edgeStatus): this {
    if (!this.isValid || this._edgeBodySent) return this;
    this._edgeStatus = statusCode;
    this._edgeHeaders.set("Content-Type", "text/plain; charset=utf-8");
    this.endEdgePayload(data);
    return this;
  }

  override buffer(data: Buffer | Uint8Array, statusCode: number = this._edgeStatus): this {
    if (!this.isValid || this._edgeBodySent) return this;
    this._edgeStatus = statusCode;
    this._edgeHeaders.set("Content-Type", "application/octet-stream");
    this.endEdgePayload(data);
    return this;
  }

  override send(data?: unknown, statusCode: number = this._edgeStatus): this {
    if (!this.isValid || this._edgeBodySent) return this;
    if (data === undefined) {
      this._edgeStatus = statusCode;
      this.endEdgePayload(null);
      return this;
    }
    if (typeof data === "string") {
      this.text(data, statusCode);
    } else if (data instanceof Uint8Array) {
      this.buffer(data, statusCode);
    } else {
      this.json(data, statusCode);
    }
    return this;
  }

  override getHeaders(): Record<string, string | string[] | undefined> {
    const headers: Record<string, string | string[]> = {};
    for (const [key, val] of this._edgeHeaders.entries()) {
      headers[key] = val;
    }
    if (typeof this._edgeHeaders.getSetCookie === "function") {
      const cookies = this._edgeHeaders.getSetCookie();
      if (cookies.length > 0) {
        headers["set-cookie"] = cookies.length === 1 ? (cookies[0] ?? "") : cookies;
      }
    }
    return headers;
  }

  override getHeader(header: string): string | undefined {
    if (isSetCookieHeaderName(header) && typeof this._edgeHeaders.getSetCookie === "function") {
      const cookies = this._edgeHeaders.getSetCookie();
      return cookies[0];
    }
    return this._edgeHeaders.get(header) ?? undefined;
  }

  override getRawHeader(header: string): string | null {
    return this._edgeHeaders.get(header);
  }

  override setHeader(key: string, value: string | number | readonly string[]): this {
    if (!this.isValid) return this;
    if (this._edgeBodySent) throw new Error("Headers already sent");
    if (Array.isArray(value)) {
      this._edgeHeaders.delete(key);
      for (const val of value) {
        this._edgeHeaders.append(key, String(val));
      }
    } else {
      this._edgeHeaders.set(key, String(value));
    }
    return this;
  }

  override removeHeader(key: string): this {
    if (!this.isValid) return this;
    if (this._edgeBodySent) throw new Error("Headers already sent");
    this._edgeHeaders.delete(key);
    return this;
  }

  override flushHeaders(): this {
    return this;
  }

  override setCookie(name: string, value: string, options: CookieOptions = {}): this {
    if (!this.isValid || this._edgeBodySent) return this;
    this._edgeHeaders.append("Set-Cookie", serializeSetCookie(name, value, options));
    return this;
  }

  override get bodyStream(): ReadableStream<Uint8Array> {
    if (this._webStream !== null) return this._webStream;

    let limit = this.app.AppOptions.bodyLimit;
    if (this._route?.bodyLimit !== undefined && this._route.bodyLimit !== null) {
      limit = Math.min(this._route.bodyLimit, limit);
    }

    let received = 0;
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
        received += chunk.byteLength;
        if (received > limit) {
          controller.error(new PayloadTooLargeError(limit.toString()));
        } else {
          controller.enqueue(chunk);
        }
      },
    });

    const body = this.req.body;
    if (body !== null) {
      this._webStream = body.pipeThrough(transform);
    } else {
      this._webStream = new ReadableStream<Uint8Array>();
    }
    return this._webStream;
  }

  override body(type: "json" | "text" = "json"): Promise<unknown> {
    if (!this.isValid) return Promise.reject(new Error("Context expired"));
    if (this._bodyPromise !== undefined) return this._bodyPromise;
    if (this.isMultipart) {
      this._bodyPromise = Promise.reject(
        new Error("Volten: Use ctx.multipart() to handle multipart/form-data streams."),
      );
      return this._bodyPromise;
    }
    if (["POST", "PUT", "PATCH"].includes(this.method)) {
      if (type === "text") {
        this._bodyPromise = this.req.text().catch(() => "");
      } else {
        const contentType = this.headers["content-type"] ?? "";
        const mediaType = typeof contentType === "string" ? extractMediaType(contentType) : "";
        if (isUrlEncodedMediaType(mediaType)) {
          this._bodyPromise = this.req
            .text()
            .then((text: string) => fastParseUrlEncoded(text))
            .catch(() => ({}));
        } else if (isJsonMediaType(mediaType)) {
          this._bodyPromise = this.req.json().catch(() => {
            throw new BadRequestError("Malformed JSON request body");
          });
        } else {
          this._bodyPromise = Promise.reject(
            new UnsupportedMediaTypeError(mediaType === "" ? "missing" : mediaType),
          );
        }
      }
    } else {
      this._bodyPromise = Promise.resolve(type === "text" ? "" : {});
    }
    return this._bodyPromise;
  }

  override async *multipart(): AsyncGenerator<MultipartPart, void, unknown> {
    if (!this.isValid) return;
    if (!this.isMultipart) return;
    try {
      const formData = await this.req.formData();
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          const file = value;
          yield {
            isFile: true,
            name: key,
            filename: file.name,
            contentType: file.type,
            stream: file.stream(),
            save: async (targetPath: string) => {
              try {
                const fs = await import("fs");
                const path = await import("path");
                const buffer = Buffer.from(await file.arrayBuffer());
                await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.promises.writeFile(targetPath, buffer);
              } catch (err) {
                throw new Error(
                  `File save is not supported in this Edge environment: ${(err as Error).message}`,
                  { cause: err },
                );
              }
            },
            buffer: async () => {
              const ab = await file.arrayBuffer();
              if (typeof Buffer !== "undefined") {
                return Buffer.from(ab);
              }
              return ab as unknown as Buffer;
            },
            text: async () => {
              return file.text();
            },
          };
        } else {
          yield {
            isFile: false,
            name: key,
            value: value,
          };
        }
      }
    } catch (err) {
      throw new Error(`Multipart parsing failed in Edge environment: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async sendFile(
    _filePath: string,
    _statusCode?: number,
    _options?: SendFileOptions,
  ): Promise<this> {
    throw new Error(
      "sendFile is not natively supported in Edge mode without platform-specific configurations.",
    );
  }
}
