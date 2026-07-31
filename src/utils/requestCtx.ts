import * as http from "http";
import fs from "fs";
import path from "path";
import { Buffer } from "node:buffer";
import type {
  Query,
  PathData,
  JSONResponseOptions,
  SendFileOptions,
  Params,
  ErrorHandler,
  CookieOptions,
  MultipartPart,
} from "../core/types.ts";
import {
  NOT_FOUND_BUF,
  NOT_FOUND_HEADERS,
  INTERNAL_SERVER_ERROR_BUF,
  INTERNAL_SERVER_ERROR_HEADERS,
} from "../core/types.ts";
import { App } from "../core/server.ts";
import { parseUrl, parseQuery } from "./parseUrl.ts";
import { createCompiledStringifier, getShapeFingerprint } from "./stringifyJson.ts";
import { isFileInFolder } from "./security.ts";
import {
  MethodNotAllowedError,
  HeadersSentError,
  NotFoundError,
  VoltenError,
  BadRequest,
} from "../core/errors.ts";
import { getMimeType } from "./mime.ts";

let DATE_HEADER_BUF = new Date().toUTCString();
const timer = setInterval(() => {
  DATE_HEADER_BUF = new Date().toUTCString();
}, 1000);
timer.unref();

export class RequestContext {
  public _app: App | null = null;
  private _req: http.IncomingMessage | null = null;
  private _res: http.ServerResponse | null = null;
  private _cookiesCache: Record<string, string> | null = null;
  public _multipartPromises: Array<Promise<void>> = [];
  public _route: PathData | null = null;
  public method!: string;
  public url!: string;
  public path!: string;
  public host!: string;
  public headers: http.IncomingHttpHeaders | null = null;
  public state: Record<string, unknown> = {};
  public params: Params = Object.create(null) as Params;
  public inited: boolean = false;

  private queryString!: string;
  private queryValue: Query | null = null;
  public _bodyPromise?: Promise<unknown> | undefined;
  public JSONOptions?: JSONResponseOptions;

  private isFlushing = false;
  private writeQueue: { str: string; resolve: () => void }[] = [];
  public static readonly BUFFER_SIZE = 64 * 1024;
  public responseBuffer = Buffer.allocUnsafe(RequestContext.BUFFER_SIZE);
  public bufferOffset = 0;

  public init(app: App, req: http.IncomingMessage, res: http.ServerResponse) {
    // Read on later: Could this be improved more?
    const urlStr = req.url ?? "/";
    const { pathname, queryStr } = parseUrl(urlStr);

    this._app = app;
    this._req = req;
    this._res = res;
    this._res.on("finish", () => {
      this._app?.resetCtx(this);
    });

    this.url = urlStr;
    this.path = pathname;
    this.queryString = queryStr;

    this.queryValue = null;
    this.params = Object.create(null) as Params;
    const headers = req.headers;
    this.host = headers.host ?? "";
    this.headers = headers;
    this.method = req.method ?? "GET";

    this._bodyPromise = undefined;
    this.bufferOffset = 0;

    // To-Do: make this conditionally cork instead of corking at all times
    // this.res!.cork();
    this.inited = true;
  }

  public async routePath() {
    if (!this.inited) return;
    const app = this.app;
    const pathname = this.path;
    const route = app.getRoute(this.method, pathname, this);
    if (route === null) {
      try {
        const staticPath = app.serverStaticMap;
        if (staticPath === null) {
          throw new Error("No static path configured for host");
        }
        const filePath = path.join(staticPath, pathname);
        if (!(await isFileInFolder(staticPath, filePath))) {
          throw new BadRequest("Attempted directory traversal attack");
        }
        this.sendFile(filePath, 200, {});
        return;
      } catch {
        const routeTree = app.getRouteTree();
        const methodsAllowed = routeTree.checkMethodAllowed(pathname);
        if (methodsAllowed.length > 0) {
          throw new MethodNotAllowedError(this.method, methodsAllowed);
        }
        throw new NotFoundError("Route Not Found");
      }
    }
    this._route = route;
  }

  public reset() {
    // To-Do: Chek if init function could replace this instead of having 2 call Per Request
    this.inited = false;
    this._app = null;
    this._req = null;
    this._res = null;
    this._route = null;
    this.headers = null;
    this.params = Object.create(null) as Params;
    this.state = {};
    this.queryValue = null;
    this._bodyPromise = undefined;
    this.bufferOffset = 0;
    this.isFlushing = false;
    this.writeQueue = [];
    this._cookiesCache = null;
  }

  get req() {
    if (this._req === null) throw new Error("Request not initialized");
    return this._req;
  }

  get res() {
    if (this._res === null) throw new Error("Response not initialized");
    return this._res;
  }

  get app() {
    if (this._app === null) throw new Error("App not initialized");
    return this._app;
  }

  get route() {
    if (this._route === null) throw new Error("Route not initialized");
    return this._route;
  }

  /**
   * Returns true if the HTTP response headers have been sent to the client.
   * At this point, status codes and headers can no longer be modified.
   */
  get headersSent(): boolean {
    return this.res.headersSent;
  }

  /**
   * Returns true if the response is completely finished (res.end() was called).
   * No more data can be written to the body.
   */
  get sent(): boolean {
    // FIX: Check BOTH writableEnded and finished for maximum compatibility
    return this.res.writableEnded;
  }

  public get isMultipart(): boolean {
    const contentType = this.req.headers["content-type"];
    if (contentType === undefined) return false;
    return contentType.includes("multipart/form-data");
  }

  public async flush(): Promise<void> {
    if (this.bufferOffset === 0 || this.isFlushing) return;

    this.isFlushing = true;

    const chunk = this.responseBuffer.subarray(0, this.bufferOffset);
    this.bufferOffset = 0;

    try {
      const ready = this.res.write(chunk);
      if (!ready) {
        await new Promise((resolve) => this.res.once("drain", resolve));
      }
    } finally {
      this.isFlushing = false;
    }

    if (this.writeQueue.length > 0) {
      const next = this.writeQueue.shift();
      if (next === undefined) return;
      const len = Buffer.byteLength(next.str);
      if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
        await this.flush();
      }

      this.bufferOffset += this.responseBuffer.write(next.str, this.bufferOffset);
      next.resolve();
    }
  }

  public async writeStatic(str: string): Promise<void> {
    if (this.isFlushing) {
      return new Promise((resolve) => {
        this.writeQueue.push({ str, resolve });
      });
    }

    const len = Buffer.byteLength(str);

    if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
      await this.flush();
    }

    this.bufferOffset += this.responseBuffer.write(str, this.bufferOffset);
  }

  public json(data: unknown, statusCode = this.res.statusCode) {
    // To-Do: Improve JIT
    const res = this.res;
    res.statusCode = statusCode;

    if (this.sent) {
      if (this._app !== null && !this.app.AppOptions.noLogs) {
        console.warn("Attempted to send JSON response after response was sent");
      }
      return this;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Server", "Volten/1.0.0");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Date", DATE_HEADER_BUF);
    // Disable JIT for every request, until JIT gets fixed
    this.route.disableOpt = true;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.route.disableOpt) {
      const body = JSON.stringify(data);
      this.setHeader("Content-Length", Buffer.byteLength(body));
      res.end(body);
      res.uncork();
      return this;
    }

    try {
      if (this.route.lastFingerprint === 0) {
        const stringified = JSON.stringify(data);
        if (stringified.length > RequestContext.BUFFER_SIZE) {
          this.route.setDeOpt();
        }
      }
    } catch {
      this.route.setDeOpt();
    }

    const finger = getShapeFingerprint(data);
    let routeCount;
    try {
      routeCount = this.app.JITCache.getCount(finger);
    } catch {
      this.app.JITCache.create(finger);
      routeCount = this.app.JITCache.getCount(finger);
    }
    const compiler = this.app.JITCache.getCompiler(finger);
    if (compiler !== null) {
      try {
        this.bufferOffset = 0;
        try {
          compiler(data, this);
          res.end(this.responseBuffer.subarray(0, this.bufferOffset));
          res.uncork();
        } catch (e: unknown) {
          if (e instanceof Error && e.message === "Buffer Overflow") {
            const body = JSON.stringify(data);
            this.setHeader("Content-Length", Buffer.byteLength(body));
            res.end(body);
            res.uncork();
          }
        }
        return this;
      } catch {
        this.app.JITCache.delete(finger);
      }
    }
    if (this.route.lastFingerprint == finger) {
      this.app.JITCache.addCount(finger);

      if (routeCount >= 10) {
        const newCompiler = createCompiledStringifier(data);
        this.app.JITCache.setCompiler(finger, newCompiler);
      }
    } else {
      this.route.setFingerprint(finger);
      this.app.JITCache.resetCount(finger);
    }

    const body = JSON.stringify(data);
    this.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
    res.uncork();
    return this;
  }

  public sendFile(filePath: string, statusCode = this.res.statusCode, options?: SendFileOptions) {
    if (this.sent) {
      if (this._app !== null && !this._app.AppOptions.noLogs) {
        console.warn("Attempted to send file after response was sent");
      }
      return this;
    }

    fs.stat(filePath, (err, stats) => {
      const regApp = this.app;

      // 1. File Not Found Handling
      if (err !== null || !stats.isFile()) {
        this.res.writeHead(404, NOT_FOUND_HEADERS);
        this.res.end(NOT_FOUND_BUF);

        if (options?.errCallback !== undefined) {
          void options.errCallback(new NotFoundError(err?.message), this);
        }

        regApp.resetCtx(this);
        return;
      }

      const ext = path.extname(filePath).toLowerCase().slice(1);
      const contentType = getMimeType(ext);

      this.res.cork();
      try {
        this.res.statusCode = statusCode;
        this.setHeader("Content-Type", contentType);
        this.setHeader("Content-Length", stats.size);
        this.setHeader("Last-Modified", stats.mtime.toUTCString());

        // 2. Fixed Content-Disposition Header Syntax
        if (options?.download !== undefined) {
          const encodedName = encodeURIComponent(options.download);
          this.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedName}`);
        } else {
          this.setHeader("Content-Type", contentType);
        }
      } finally {
        this.res.uncork();
      }

      // 3. Stream Pipeline Execution
      const stream = fs.createReadStream(filePath);
      stream.pipe(this.res);

      this.res.on("close", () => {
        stream.destroy();
        regApp.resetCtx(this);
      });

      stream.on("error", (streamErr) => {
        if (!regApp.AppOptions.noLogs) {
          console.error("Stream error:", streamErr);
        }
        stream.destroy();

        const normalizedErr = VoltenError.from(streamErr);
        if (!this.res.headersSent) {
          this.res.writeHead(500, INTERNAL_SERVER_ERROR_HEADERS);
          this.res.end(INTERNAL_SERVER_ERROR_BUF);

          if (options?.errCallback !== undefined) {
            void options.errCallback(normalizedErr, this);
          }

          regApp.resetCtx(this);
        } else {
          if (options?.errCallback !== undefined) {
            void options.errCallback(normalizedErr, this);
          }
          this.res.destroy();
        }
      });
    });

    return this;
  }

  public download(
    filePath: string,
    fileName: string,
    statusCode = this.res.statusCode,
    errCallback?: ErrorHandler,
  ) {
    const options: SendFileOptions = {
      download: fileName,
    };
    if (errCallback !== undefined) options.errCallback = errCallback;
    return this.sendFile(filePath, statusCode, options);
  }

  public buffer(data: Buffer, statusCode: number) {
    if (this.sent) {
      if (this.app.AppOptions.noLogs) {
        console.warn("Attempted to send buffer after response was sent");
      }
      return this;
    }
    this.res.statusCode = statusCode;
    this.setHeader("Content-Type", "application/octet-stream; charset=utf-8");
    this.setHeader("Content-Length", data.length);
    this.res.end(data);
    return this;
  }

  get query() {
    if (this.queryValue === null) {
      this.queryValue = parseQuery(this.queryString);
    }
    return this.queryValue;
  }

  public get cookies(): Record<string, string> {
    if (this._cookiesCache !== null) {
      return this._cookiesCache;
    }
    const rawCookieHeader = this.req.headers["cookie"];
    if (rawCookieHeader === undefined || rawCookieHeader.length === 0) {
      this._cookiesCache = Object.freeze({});
      return this._cookiesCache;
    }
    const parsedCookies: Record<string, string> = {};
    let start = 0;
    const len = rawCookieHeader.length;
    while (start < len) {
      while (start < len && rawCookieHeader.charCodeAt(start) === 32) {
        start++;
      }
      if (start >= len) break;
      const equalsIdx = rawCookieHeader.indexOf("=", start);
      if (equalsIdx === -1) break;
      let semiIdx = rawCookieHeader.indexOf(";", equalsIdx);
      if (semiIdx === -1) {
        semiIdx = len;
      }
      const rawKey = rawCookieHeader.slice(start, equalsIdx).trim();
      const rawVal = rawCookieHeader.slice(equalsIdx + 1, semiIdx).trim();
      try {
        parsedCookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal);
      } catch {
        parsedCookies[rawKey] = rawVal;
      }
      start = semiIdx + 1;
    }
    this._cookiesCache = parsedCookies;
    return this._cookiesCache;
  }

  public body(type: "json" | "text" = "json"): Promise<unknown> {
    if (this._bodyPromise !== undefined) return this._bodyPromise;

    // Strict Separation Guard: Fast-reject if calling .body() on a multipart stream
    if (this.isMultipart) {
      this._bodyPromise = Promise.reject(
        new Error(
          "Volten: Cannot parse multipart/form-data via ctx.body(). Use ctx.multipart() instead to stream binary components safely.",
        ),
      );
      return this._bodyPromise;
    }

    if (["POST", "PUT", "PATCH"].includes(this.method)) {
      // Execute the parser directly passing 'this' as the context instance
      this._bodyPromise = this.app.parseBody.call(this.app, this, type === "text");
    } else {
      if (!this.app.AppOptions.noLogs) {
        console.warn(
          `Attempted to access body on a ${this.method} request; returning empty fallback.`,
        );
      }
      this._bodyPromise = Promise.resolve(type === "text" ? "" : {});
    }

    return this._bodyPromise;
  }

  /**
   * Streams incoming multipart data fields and files sequentially straight from the socket connection.
   */
  public async *multipart(): AsyncGenerator<MultipartPart, void, unknown> {
    if (!this.isMultipart) {
      if (!this.app.AppOptions.noLogs) {
        console.warn("Attempted to call ctx.multipart() on a non-multipart request header.");
      }
      return;
    }

    // Delegate the generator execution cleanly to the bodyparser utility
    yield* this.app.parseMultipartStream.call(this.app, this);
  }

  get statusCode() {
    return this.res.statusCode;
  }
  set statusCode(code: number) {
    this.res.statusCode = code;
  }

  get type() {
    const type = this.res.getHeader("Content-Type");
    return typeof type === "string" ? (type.split(";")[0] ?? "") : "";
  }
  set type(value: string) {
    this.setHeader("Content-Type", value);
  }

  // --- HELPER METHODS ---

  public status(code: number): this {
    this.res.statusCode = code;
    return this;
  }

  public text(data: string, statusCode = this.res.statusCode) {
    const body = data;
    if (this.sent) {
      if (!this.app.AppOptions.noLogs) {
        console.warn("Attempted to send text response after response was sent");
      }
      return this;
    }
    this.res.statusCode = statusCode;
    if (!this.headersSent) {
      this.setHeader("Content-Type", "text/plain; charset=utf-8");
      this.setHeader("Content-Length", Buffer.byteLength(body));
    } else {
      if (!this.app.AppOptions.noLogs) {
        console.warn("Headers Already Sent, Sending Only Body");
      }
    }
    this.res.end(body);
    this.res.uncork();
    return this;
  }

  public send(data: unknown, statusCode = this.res.statusCode) {
    this.res.cork();
    if (typeof data === "string") {
      this.text(data, statusCode);
    } else if (Buffer.isBuffer(data)) {
      this.buffer(data, statusCode);
    } else {
      this.json(data, statusCode);
    }
    return this;
  }

  public setHeader(key: string, value: string | number | readonly string[]): this {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.setHeader(key, value);
    return this;
  }

  removeHeader(key: string) {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.removeHeader(key);
    return this;
  }

  flushHeaders() {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.flushHeaders();
    return this;
  }

  public setCookie(name: string, value: string, options: CookieOptions = {}) {
    let str = encodeURIComponent(name) + "=" + encodeURIComponent(value);
    if (options.path !== undefined) {
      str += "; Path=" + options.path;
    } else {
      str += "; Path=/";
    }

    if (options.maxAge !== undefined) {
      str += "; Max-Age=" + String(options.maxAge);
    }

    if (options.expires !== undefined) {
      str += "; Expires=" + options.expires.toUTCString();
    }

    if (options.domain !== undefined) {
      str += "; Domain=" + options.domain;
    }

    if (options.sameSite !== undefined) {
      const ss = options.sameSite;
      str += "; SameSite=" + (ss === "lax" ? "Lax" : ss === "strict" ? "Strict" : "None");
    }

    if (options.secure === true) {
      str += "; Secure";
    }

    if (options.httpOnly === true) {
      str += "; HttpOnly";
    }
    const existing = this.res.getHeader("Set-Cookie");

    if (existing === undefined) {
      this.setHeader("Set-Cookie", str);
    } else if (typeof existing === "string") {
      this.setHeader("Set-Cookie", [existing, str]);
    } else if (Array.isArray(existing)) {
      this.setHeader("Set-Cookie", [...existing, str]);
    }
    return this;
  }
}
