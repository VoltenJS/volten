import * as http from "http";
import fs from "fs";
import path from "path";
import { Buffer } from "node:buffer";
import {
  Context,
  Query,
  PathData,
  JSONResponseOptions,
  SendFileOptions,
  Params,
  NOT_FOUND_BUF,
  NOT_FOUND_HEADERS,
  GenericErrorHandler,
  INTERNAL_SERVER_ERROR_BUF,
  INTERNAL_SERVER_ERROR_HEADERS,
  CookieOptions,
} from "../core/types.ts";
import { App } from "../core/server.ts";
import { parseUrl, parseQuery } from "./parseurl.ts";
import {
  createCompiledStringifier,
  getShapeFingerprint,
} from "./stringifyjson.ts";
import { isFileInFolder } from "./security.ts";

let DATE_HEADER_BUF = new Date().toUTCString();
setInterval(() => {
  DATE_HEADER_BUF = new Date().toUTCString();
}, 1000);

export class RequestContext implements Context {
  public _app!: App;
  private _req!: http.IncomingMessage;
  private _res!: http.ServerResponse;
  private _cookiesCache: Record<string, string> | null = null;
  public route!: PathData;
  public method!: string;
  public url!: string;
  public path!: string;
  public host!: string;
  public headers!: http.IncomingHttpHeaders;
  public state: Record<string, any> = {};
  public params: Params = {};
  public inited: boolean = false;

  private queryString!: string;
  private queryValue: Query | null = null;
  public _bodyPromise?: Promise<any>;
  public JSONOptions?: JSONResponseOptions;

  private isFlushing = false;
  private writeQueue: { str: string; resolve: () => void }[] = [];
  public static readonly BUFFER_SIZE = 64 * 1024;
  public responseBuffer = Buffer.allocUnsafe(RequestContext.BUFFER_SIZE);
  public bufferOffset = 0;

  public init(app: App, req: http.IncomingMessage, res: http.ServerResponse) {
    // Read on later: Could this be improved more?
    const urlStr = req.url || "/";
    const { pathname, queryStr } = parseUrl(urlStr);

    this._app = app;
    this._req = req;
    this._res = res;
    this.url = urlStr;
    this.path = pathname;
    this.queryString = queryStr;

    this.queryValue = null;
    this.params = Object.create(null);
    const headers = req.headers;
    this.host = headers.host || "";
    this.headers = headers;
    this.method = req.method || "GET";
    const route =
      app.getRoute(this.method, this.host, pathname, this) ||
      app.getRoute(this.method, "**", pathname, this);
    if (!route) {
      const staticPath =
        app.serverStaticMap.get(this.host) || app.serverStaticMap.get("**");
      if (staticPath) {
        const filePath = path.join(staticPath, pathname);
        if (isFileInFolder(staticPath, filePath)) {
          this.sendFile(filePath, 200, {});
          return;
        }
      }
      this.res.writeHead(404, NOT_FOUND_HEADERS);
      this.res.end(NOT_FOUND_BUF);
      return;
    }
    this.route = route;

    this._bodyPromise = undefined;
    this.bufferOffset = 0;

    // To-Do: make this conditionally cork instead of corking at all times
    // this.res.cork();
    this.inited = true;
  }

  public reset() {
    // To-Do: Chek if init function could replace this instead of having 2 call Per Request
    this.inited = false;
    this._app = null as any;
    this._req = null as any;
    this._res = null as any;
    this.route = null as any;
    this.headers = null as any;
    for (const key in this.state) delete this.state[key];
    this.queryValue = null;
    this._bodyPromise = undefined;
    this.bufferOffset = 0;
    this.isFlushing = false;
    this.writeQueue = [];
    this._cookiesCache = null;
  }

  get req() {
    return this._req;
  }

  get res() {
    return this._res;
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
      const next = this.writeQueue.shift()!;

      const len = Buffer.byteLength(next.str);
      if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
        await this.flush();
      }

      this.bufferOffset += this.responseBuffer.write(
        next.str,
        this.bufferOffset,
      );
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

  public json(data: any, statusCode: number = 200) {
    // To-Do: Improve JIT
    const res = this.res;
    res.statusCode = statusCode;

    if (this.sent) {
      return this;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Server", "Volten/1.0.0");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Date", DATE_HEADER_BUF);
    // Disable JIT for every request, until JIT gets fixed
    this.route.disableOpt = true;
    if (this.route.disableOpt) {
      const body = JSON.stringify(data);
      this.res.setHeader("Content-Length", Buffer.byteLength(body));
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
    } catch (e) {
      this.route.setDeOpt();
    }

    const finger = getShapeFingerprint(data);
    let routeCount = 0;
    try {
      routeCount = this._app.JITCache.getCount(finger);
    } catch {
      this._app.JITCache.create(finger);
      routeCount = this._app.JITCache.getCount(finger);
    }
    const compiler = this._app.JITCache.getCompiler(finger);
    if (compiler) {
      try {
        this.bufferOffset = 0;
        try {
          compiler(data, this);
          res.end(this.responseBuffer.subarray(0, this.bufferOffset));
          res.uncork();
        } catch (e: any) {
          if (e.message === "Buffer Overflow") {
            const body = JSON.stringify(data);
            this.res.setHeader("Content-Length", Buffer.byteLength(body));
            res.end(body);
            res.uncork();
          }
        }
        return this;
      } catch (e) {
        this._app.JITCache.delete(finger);
      }
    }
    if (this.route.lastFingerprint == finger) {
      this._app.JITCache.addCount(finger);

      if (routeCount >= 10) {
        const newCompiler = createCompiledStringifier(data);
        this._app.JITCache.setCompiler(finger, newCompiler);
      }
    } else {
      this.route.setFingerprint(finger);
      this._app.JITCache.resetCount(finger);
    }

    const body = JSON.stringify(data);
    this.res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
    res.uncork();
    return this;
  }

  public sendFile(
    filePath: string,
    statusCode = 200,
    options?: SendFileOptions,
  ) {
    this.res.cork();
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        this.res.writeHead(404, NOT_FOUND_HEADERS);
        this.res.end(NOT_FOUND_BUF);
        return;
      }

      const ext = path.extname(filePath).toLowerCase().slice(1);
      const contentType = this.getMimeType(ext);

      this.res.statusCode = statusCode;
      this.res.setHeader("Content-Type", contentType);
      this.res.setHeader("Content-Length", stats.size);
      this.res.setHeader("Last-Modified", stats.mtime.toUTCString());
      if (options?.download) {
        this.res.setHeader(
          "Content-Disposition",
          "attachment; filename=" + encodeURIComponent(options?.download),
        );
      }

      const stream = fs.createReadStream(filePath);

      this.res.uncork();

      stream.pipe(this.res);

      this.res.on("close", () => {
        stream.destroy();
      });

      stream.on("error", (streamErr) => {
        console.error("Stream error:", streamErr);
        if (options?.errCallback) {
          return options.errCallback(streamErr, this);
        }
        if (!this.res.headersSent) {
          this.res.writeHead(404, INTERNAL_SERVER_ERROR_HEADERS);
          this.res.end(INTERNAL_SERVER_ERROR_BUF);
        } else {
          this.res.destroy();
        }
      });
    });

    return this;
  }

  public download(
    filePath: string,
    fileName: string,
    statusCode = 200,
    errCallback?: GenericErrorHandler,
  ) {
    this.sendFile(filePath, statusCode, {
      download: fileName,
      errCallback,
    });
  }
  public getMimeType(ext: string): string {
    // This was generated by Gemini
    const MIMES: Record<string, string> = {
      // Text & Logic
      html: "text/html; charset=utf-8",
      htm: "text/html; charset=utf-8",
      js: "text/javascript; charset=utf-8",
      mjs: "text/javascript; charset=utf-8",
      css: "text/css; charset=utf-8",
      json: "application/json; charset=utf-8",
      jsonld: "application/ld+json",
      txt: "text/plain; charset=utf-8",
      xml: "application/xml",

      // Images
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      bmp: "image/bmp",
      tiff: "image/tiff",

      // Fonts
      woff: "font/woff",
      woff2: "font/woff2",
      ttf: "font/ttf",
      otf: "font/otf",
      eot: "application/vnd.ms-fontobject",

      // Video
      mp4: "video/mp4",
      webm: "video/webm",
      ogv: "video/ogg",
      mov: "video/quicktime",
      avi: "video/x-msvideo",

      // Audio
      mp3: "audio/mpeg",
      wav: "audio/wav",
      flac: "audio/flac",
      ogg: "audio/ogg",
      m4a: "audio/mp4",
      aac: "audio/aac",

      // Documents
      pdf: "application/pdf",
      zip: "application/zip",
      gz: "application/gzip",
      rar: "application/vnd.rar",
      "7z": "application/x-7z-compressed",
      tar: "application/x-tar",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      csv: "text/csv",

      // Binary / Fallback
      bin: "application/octet-stream",
      exe: "application/octet-stream",
      wasm: "application/wasm",
    };
    return MIMES[ext.toLowerCase()] || "application/octet-stream";
  }

  public buffer(data: Buffer, statusCode: number) {
    this.res.statusCode = statusCode;
    this.res.setHeader(
      "Content-Type",
      "application/octet-stream; charset=utf-8",
    );
    this.res.setHeader("Content-Length", data.length);
    this.res.end(data);
  }

  get query() {
    if (!this.queryValue) {
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
      let equalsIdx = rawCookieHeader.indexOf("=", start);
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

  /**
   * Resolves the incoming request payload stream.
   * @param type - "json" (attempts JSON with string fallback) or "text" (forces raw text string)
   */
  public body(type: "json" | "text" = "json"): Promise<any> {
    if (this._bodyPromise) return this._bodyPromise;

    if (["POST", "PUT", "PATCH"].includes(this.method)) {
      this._bodyPromise = this._app.parseBody(this, type === "text");
    } else {
      console.warn(
        `Attempted to access body on a ${this.method} request; returning empty fallback.`,
      );
      this._bodyPromise = Promise.resolve(type === "text" ? "" : {});
    }

    return this._bodyPromise;
  }

  get statusCode() {
    return this.res.statusCode || 200;
  }
  set statusCode(code: number) {
    this.res.statusCode = code;
  }

  get type() {
    const type = this.res.getHeader("Content-Type");
    return typeof type === "string" ? type.split(";")[0] : "";
  }
  set type(value: string) {
    this.setHeader("Content-Type", value);
  }

  get sent() {
    return this.res.headersSent;
  }

  // --- HELPER METHODS ---

  public setHeader(
    key: string,
    value: string | number | readonly string[],
  ): this {
    if (!this.res.headersSent) this.res.setHeader(key, value);
    return this;
  }

  public status(code: number): this {
    this.res.statusCode = code;
    return this;
  }

  public text(data: string, statusCode = 200) {
    const body = String(data);
    this.res.statusCode = statusCode;
    this.res.setHeader("Content-Type", "text/plain; charset=utf-8");
    this.res.setHeader("Content-Length", Buffer.byteLength(body));
    this.res.end(body);
    this.res.uncork();
    return this;
  }

  public send(data: any, statusCode = 200) {
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

  removeHeader(key: string) {
    if (this.res.headersSent) {
      console.warn("Attempted to remove a header after headers were sent");
      return this;
    }
    this.res.removeHeader(key);
    return this;
  }

  flushHeaders() {
    if (this.res.headersSent) {
      console.warn("Attempted to flush headers after headers were sent");
      return this;
    }
    this.res.flushHeaders();
    return this;
  }

  public setCookie(
    name: string,
    value: string,
    options: CookieOptions = {},
  ): void {
    let str = encodeURIComponent(name) + "=" + encodeURIComponent(value);
    if (options.path !== undefined) {
      str += "; Path=" + options.path;
    } else {
      str += "; Path=/";
    }

    if (options.maxAge !== undefined) {
      str += "; Max-Age=" + options.maxAge;
    }

    if (options.expires !== undefined) {
      str += "; Expires=" + options.expires.toUTCString();
    }

    if (options.domain !== undefined) {
      str += "; Domain=" + options.domain;
    }

    if (options.sameSite !== undefined) {
      const ss = options.sameSite;
      str +=
        "; SameSite=" +
        (ss === "lax" ? "Lax" : ss === "strict" ? "Strict" : "None");
    }

    if (options.secure === true) {
      str += "; Secure";
    }

    if (options.httpOnly === true) {
      str += "; HttpOnly";
    }
    const existing = this.res.getHeader("Set-Cookie");

    if (existing === undefined) {
      this.res.setHeader("Set-Cookie", str);
    } else if (typeof existing === "string") {
      this.res.setHeader("Set-Cookie", [existing, str]);
    } else if (Array.isArray(existing)) {
      existing.push(str);
      this.res.setHeader("Set-Cookie", existing);
    }
  }
}
