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
import { App } from "../core/server.ts";
import { parseUrl, parseQuery } from "./parseUrl.ts";
import { createCompiledStringifier } from "./stringifyJson.ts";
import { isFileInFolder } from "./security.ts";
import {
  MethodNotAllowedError,
  HeadersSentError,
  NotFoundError,
  VoltenError,
  BadRequestError,
} from "../core/errors.ts";
import { getMimeType } from "./mime.ts";

let DATE_HEADER_BUF = new Date().toUTCString();
const timer = setInterval(() => {
  DATE_HEADER_BUF = new Date().toUTCString();
}, 1000);
timer.unref();

export class RequestContext {
  public _app: App<string> | null = null;
  private _req: http.IncomingMessage | null = null;
  private _res: http.ServerResponse | null = null;
  private _cookiesCache: Record<string, string> | null = null;
  public _multipartPromises: Array<Promise<void>> = [];
  public _route: PathData | null = null;
  public method!: string;
  public url!: string;
  public path!: string;
  public _headers: http.IncomingHttpHeaders | null = null;
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

  /**
   * Initializes the request context with the app instance, request, and response objects.
   *
   * Sets up basic request properties like URL, path, query string, parameters, and headers.
   *
   * @param {App<string>} app - The Volten application instance.
   * @param {http.IncomingMessage} req - The incoming Node.js HTTP request.
   * @param {http.ServerResponse} res - The outgoing Node.js HTTP response.
   *
   * @example
   * ctx.init(app, req, res);
   */
  public init(app: App<string>, req: http.IncomingMessage, res: http.ServerResponse) {
    // Read on later: Could this be improved more?
    const urlStr = req.url ?? "/";
    const { pathname, queryStr } = parseUrl(urlStr);

    this._app = app;
    this._req = req;
    this._res = res;

    this.url = urlStr;
    this.path = pathname;
    this.queryString = queryStr;

    this.queryValue = null;
    this.params = Object.create(null) as Params;
    const headers = req.headers;
    this._headers = headers;
    this.method = req.method ?? "GET";

    this._bodyPromise = undefined;
    this.bufferOffset = 0;

    // To-Do: make this conditionally cork instead of corking at all times
    // this.res!.cork();
    this.inited = true;
  }

  /**
   * Routes the incoming request path against the application's registered routes.
   *
   * If a matching route is found, initializes the route metadata. If no route is found,
   * attempts to serve static assets or throws appropriate HTTP errors (e.g. 404, 405).
   *
   * @returns {Promise<void>} A promise that resolves when routing or fallback handling is complete.
   *
   * @example
   * await ctx.routePath();
   */
  public async routePath(): Promise<void> {
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
          throw new BadRequestError("Attempted directory traversal attack");
        }
        await this.sendFile(filePath, 200, {});
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

  /**
   * Resets the request context state, making it ready for reuse in the connection pool.
   *
   * Clears internal references, caches, route metadata, response buffers, and queue states.
   *
   * @example
   * ctx.reset();
   */
  public reset() {
    // To-Do: Chek if init function could replace this instead of having 2 call Per Request
    this.inited = false;
    this._app = null;
    this._req = null;
    this._res = null;
    this._route = null;
    this._headers = null;
    this.params = Object.create(null) as Params;
    this.state = {};
    this.queryValue = null;
    this._bodyPromise = undefined;
    this.bufferOffset = 0;
    this.isFlushing = false;
    this.writeQueue = [];
    this._cookiesCache = null;
  }

  /**
   * Gets the underlying Node.js HTTP request object.
   *
   * Throws an error if the request context has not been initialized.
   *
   * @returns {http.IncomingMessage} The Node.js HTTP request instance.
   *
   * @example
   * const method = ctx.req.method;
   */
  get req(): http.IncomingMessage {
    if (this._req === null) throw new Error("Request not initialized");
    return this._req;
  }

  /**
   * Gets the underlying Node.js HTTP response object.
   *
   * Throws an error if the request context has not been initialized.
   *
   * @returns {http.ServerResponse} The Node.js HTTP response instance.
   *
   * @example
   * ctx.res.setHeader('X-Custom-Header', 'value');
   */
  get res(): http.ServerResponse {
    if (this._res === null) throw new Error("Response not initialized");
    return this._res;
  }

  /**
   * Gets the Volten application instance.
   *
   * Throws an error if the request context has not been initialized.
   *
   * @returns {App<string>} The Volten application instance.
   *
   * @example
   * const options = ctx.app.AppOptions;
   */
  get app(): App<string> {
    if (this._app === null) throw new Error("App not initialized");
    return this._app;
  }

  /**
   * Gets the matched route metadata for the current request.
   *
   * Throws an error if the route has not been resolved or initialized.
   *
   * @returns {PathData} The matched route path data and options.
   *
   * @example
   * const routeHandler = ctx.route.handler;
   */
  get route(): PathData {
    if (this._route === null) throw new Error("Route not initialized");
    return this._route;
  }

  /**
   * Gets the HTTP headers of the incoming request.
   *
   * @returns {http.IncomingHttpHeaders} An object containing request headers, or an empty object.
   *
   * @example
   * const userAgent = ctx.headers['user-agent'];
   */
  get headers(): http.IncomingHttpHeaders {
    return this._headers ?? {};
  }

  /**
   * Returns true if the HTTP response headers have been sent to the client.
   *
   * At this point, status codes and headers can no longer be modified.
   *
   * @returns {boolean} Whether headers have been sent.
   *
   * @example
   * if (!ctx.headersSent) {
   *   ctx.setHeader('Content-Type', 'text/html');
   * }
   */
  get headersSent(): boolean {
    return this.res.headersSent;
  }

  /**
   * Returns true if the response is completely finished.
   *
   * Indicates whether `res.end()` has been called, meaning no more data can be written to the response body.
   *
   * @returns {boolean} Whether the response is finished.
   *
   * @example
   * if (ctx.sent) return;
   */
  get sent(): boolean {
    return this._res === null ? true : this.res.writableEnded;
  }

  /**
   * Gets the client's real IP address.
   *
   * Automatically resolves reverse-proxy header chains in the following order:
   * 1. `X-Forwarded-For` (returns the origin client IP)
   * 2. `CF-Connecting-IP` (Cloudflare proxy fallback)
   * 3. Underlying socket `remoteAddress`
   *
   * @returns {string} The client IP address, or an empty string if unresolvable.
   *
   * @example
   * app.get('/me', (ctx) => {
   *   return ctx.send(`Your IP is: ${ctx.ip}`);
   * });
   */
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
    return this.req.socket.remoteAddress ?? "";
  }

  /**
   * Returns the hostname (without port).
   *
   * Automatically handles reverse proxies using the `X-Forwarded-Host` or `Host` headers.
   *
   * @returns {string} The hostname, or an empty string if not present.
   *
   * @example
   * const host = ctx.hostname; // 'example.com'
   */
  get hostname(): string {
    const host = this.headers["x-forwarded-host"] ?? this.headers["host"];
    if (host === undefined || typeof host !== "string") return "";

    // Extract first host if comma-separated (proxy chain)
    const firstHost = host.includes(",") ? (host.split(",")[0] ?? "").trim() : host;

    // Strip port number if present (handling IPv6 brackets correctly)
    const portIndex = firstHost.lastIndexOf(":");
    const bracketIndex = firstHost.indexOf("]");

    if (portIndex !== -1 && portIndex > bracketIndex) {
      return firstHost.substring(0, portIndex);
    }

    return firstHost;
  }

  /**
   * Returns the raw host header including the port number if present.
   *
   * Handles reverse proxies automatically by checking `X-Forwarded-Host` before falling back to `Host`.
   *
   * @returns {string} The host string, or an empty string if not present.
   *
   * @example
   * const host = ctx.host; // 'example.com:8080'
   */
  get host(): string {
    const host = this.headers["x-forwarded-host"] ?? this.headers["host"];
    if (host === undefined || typeof host !== "string") return "";
    return host.includes(",") ? (host.split(",")[0] ?? "").trim() : host;
  }

  /**
   * Checks if the incoming request content type is multipart form data.
   *
   * @returns {boolean} True if the request is multipart, false otherwise.
   *
   * @example
   * if (ctx.isMultipart) {
   *   // parse multipart stream
   * }
   */
  public get isMultipart(): boolean {
    const contentType = this.req.headers["content-type"];
    if (contentType === undefined) return false;
    return contentType.includes("multipart/form-data");
  }

  /**
   * Flushes the buffered response data to the underlying socket connection.
   *
   * If the client's backpressure is triggered, waits for the socket `drain` event before continuing.
   *
   * @returns {Promise<void>} A promise that resolves when the buffered data has been flushed.
   *
   * @example
   * await ctx.flush();
   */
  public async flush(): Promise<void> {
    if ((this.bufferOffset === 0 && this.writeQueue.length === 0) || this.isFlushing) return;
    try {
      this.isFlushing = true;
      if (this.bufferOffset > 0) {
        const chunk = this.responseBuffer.subarray(0, this.bufferOffset);
        this.bufferOffset = 0;
        const ready = this.res.write(chunk);
        if (!ready) {
          await new Promise((resolve) => this.res.once("drain", resolve));
        }
      }

      while (this.writeQueue.length > 0) {
        const next = this.writeQueue[0];
        if (next === undefined) break;
        const len = Buffer.byteLength(next.str);
        if (this.bufferOffset + len > RequestContext.BUFFER_SIZE) {
          const chunk = this.responseBuffer.subarray(0, this.bufferOffset);
          this.bufferOffset = 0;

          const ready = this.res.write(chunk);
          if (!ready) {
            await new Promise((resolve) => this.res.once("drain", resolve));
          }
        }

        this.writeQueue.shift();
        this.bufferOffset += this.responseBuffer.write(next.str, this.bufferOffset);
        next.resolve();
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Writes static string chunk data to the response buffer.
   *
   * Flushes the buffer automatically if the written chunk causes the buffer to exceed the maximum buffer size.
   *
   * @param {string} str - The string content to write.
   * @returns {Promise<void>} A promise that resolves when the data is written to the buffer.
   *
   * @example
   * await ctx.writeStatic('Hello, ');
   */
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

  /**
   * Sends a JSON response to the client.
   *
   * Utilizes fast just-in-time schema compilation and stringification if optimized route serialization is enabled.
   *
   * @param {unknown} data - The payload to stringify and send as JSON.
   * @param {number} [statusCode=this.res.statusCode] - Optional HTTP status code to set for the response.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.json({ status: 'ok' }, 200);
   */
  public json(data: unknown, statusCode: number = this.res.statusCode): this {
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

    if (this._route === null || this.route.disableOpt) {
      const body = JSON.stringify(data);
      this.setHeader("Content-Length", Buffer.byteLength(body));
      res.end(body);
      res.uncork();
      return this;
    }

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
      const body = serializer(data);
      this.setHeader("Content-Length", body.length);
      res.end(body);
      res.uncork();
      return this;
    } catch {
      const body = JSON.stringify(data);
      this.setHeader("Content-Length", Buffer.byteLength(body));
      res.end(body);
      res.uncork();
      return this;
    }
  }

  /**
   * Sends a file located at the specified file path as the response body.
   *
   * Streams the file directly to the response socket, automatically setting the appropriate `Content-Type`,
   * `Content-Length`, `Last-Modified`, and content disposition headers.
   *
   * @param {string} filePath - The absolute path of the file to send.
   * @param {number} [statusCode=this.res.statusCode] - Optional HTTP status code.
   * @param {SendFileOptions} [options] - Additional send options, such as download file name and error callback.
   * @returns {Promise<this>} A promise resolving to the context instance.
   *
   * @example
   * await ctx.sendFile('/path/to/image.png');
   */
  public async sendFile(
    filePath: string,
    statusCode: number = this.res.statusCode,
    options?: SendFileOptions,
  ): Promise<this> {
    if (this.sent) {
      if (this._app !== null && !this._app.AppOptions.noLogs) {
        console.warn("Attempted to send file after response was sent");
      }
      return this;
    }
    try {
      const stats = await fs.promises.stat(filePath);
      const regApp = this.app;

      if (!stats.isFile()) {
        const error = new NotFoundError("Resource Not Found");
        if (options?.errCallback !== undefined) {
          void options.errCallback(error, this);
        }
        throw error;
      }

      const ext = path.extname(filePath).toLowerCase().slice(1);
      const contentType = getMimeType(ext);

      this.res.cork();
      try {
        this.res.statusCode = statusCode;
        this.setHeader("Content-Type", contentType);
        this.setHeader("Content-Length", stats.size);
        this.setHeader("Last-Modified", stats.mtime.toUTCString());

        if (options?.download !== undefined) {
          const encodedName = encodeURIComponent(options.download);
          this.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedName}`);
        } else {
          this.setHeader("Content-Type", contentType);
        }
      } finally {
        this.res.uncork();
      }

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

        if (options?.errCallback !== undefined) {
          void options.errCallback(normalizedErr, this);
        }
        void this.app.handleError(normalizedErr, this);
      });
    } catch {
      const error = new NotFoundError("Resource Not Found");
      if (options?.errCallback !== undefined) {
        void options.errCallback(error, this);
      }
      throw error;
    }

    return this;
  }

  /**
   * Triggers a file download on the client side by serving the file with attachment headers.
   *
   * @param {string} filePath - The absolute path of the file to download.
   * @param {string} fileName - The default file name suggested to the client.
   * @param {number} [statusCode=this.res.statusCode] - Optional HTTP status code.
   * @param {ErrorHandler} [errCallback] - Optional error callback if serving the file fails.
   * @returns {Promise<this>} A promise resolving to the context instance.
   *
   * @example
   * await ctx.download('/path/to/report.pdf', 'monthly-report.pdf');
   */
  public download(
    filePath: string,
    fileName: string,
    statusCode: number = this.res.statusCode,
    errCallback?: ErrorHandler,
  ): Promise<this> {
    const options: SendFileOptions = {
      download: fileName,
    };
    if (errCallback !== undefined) options.errCallback = errCallback;
    return this.sendFile(filePath, statusCode, options);
  }

  /**
   * Sends raw binary buffer data as the response body.
   *
   * Automatically sets the content type to `application/octet-stream`.
   *
   * @param {Buffer} data - The raw Buffer to send.
   * @param {number} statusCode - The HTTP status code to set.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.buffer(Buffer.from('hello'), 200);
   */
  public buffer(data: Buffer, statusCode: number): this {
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

  /**
   * Gets the parsed query parameters from the request URL.
   *
   * Caches the parsed query object for subsequent accesses during the request lifecycle.
   *
   * @returns {Query} An object containing parsed query parameters.
   *
   * @example
   * const search = ctx.query.search;
   */
  get query(): Query {
    if (this.queryValue === null) {
      this.queryValue = parseQuery(this.queryString);
    }
    return this.queryValue;
  }

  /**
   * Gets the parsed cookies sent in the request headers.
   *
   * Caches parsed cookies dynamically for rapid access.
   *
   * @returns {Record<string, string>} A dictionary of cookie names and their values.
   *
   * @example
   * const sessionId = ctx.cookies.session_id;
   */
  public get cookies(): Record<string, string> {
    if (this._cookiesCache !== null) {
      return this._cookiesCache;
    }
    const rawCookieHeader = this.req.headers["cookie"];
    if (rawCookieHeader === undefined || rawCookieHeader.length === 0) {
      this._cookiesCache = Object.freeze({});
      return this._cookiesCache;
    }
    const parsedCookies: Record<string, string> = Object.create(null) as Record<string, string>;
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

  /**
   * Parses and returns the request body.
   *
   * Automatically parses standard content types (e.g. JSON or text) depending on the specified format.
   * Will reject if called on a multipart stream request.
   *
   * @param {"json" | "text"} [type="json"] - The desired parsing format.
   * @returns {Promise<unknown>} A promise resolving to the parsed request body.
   *
   * @example
   * const payload = await ctx.body('json');
   */
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
   *
   * @returns {AsyncGenerator<MultipartPart, void, unknown>} An async generator yielding multipart parts.
   *
   * @example
   * for await (const part of ctx.multipart()) {
   *   if (part.isFile) {
   *     // Process file stream: part.stream
   *   }
   * }
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

  /**
   * Gets or sets the HTTP status code of the response.
   *
   * @returns {number} The current response HTTP status code.
   *
   * @example
   * ctx.statusCode = 404;
   */
  get statusCode(): number {
    return this.res.statusCode;
  }
  set statusCode(code: number) {
    this.res.statusCode = code;
  }

  /**
   * Gets or sets the Content-Type header of the response (excluding encoding/parameters).
   *
   * @returns {string} The MIME type.
   *
   * @example
   * ctx.type = 'text/html';
   */
  get type(): string {
    const type = this.res.getHeader("Content-Type");
    return typeof type === "string" ? (type.split(";")[0] ?? "") : "";
  }
  set type(value: string) {
    this.setHeader("Content-Type", value);
  }

  // --- HELPER METHODS ---

  /**
   * Sets the HTTP status code of the response.
   *
   * Helper method supporting method chaining.
   *
   * @param {number} code - The HTTP status code to set.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.status(201).json({ created: true });
   */
  public status(code: number): this {
    this.res.statusCode = code;
    return this;
  }

  /**
   * Sends a plain text response to the client.
   *
   * @param {string} data - The text content to send.
   * @param {number} [statusCode=this.res.statusCode] - Optional HTTP status code.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.text('Hello World', 200);
   */
  public text(data: string, statusCode: number = this.res.statusCode): this {
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

  /**
   * Sends a response to the client, automatically determining the content type.
   *
   * Strings are sent as plain text, buffers as octet streams, and other objects/types as JSON.
   *
   * @param {unknown} data - The data payload to send.
   * @param {number} [statusCode=this.res.statusCode] - Optional HTTP status code.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.send('Hello from server');
   */
  public send(data: unknown, statusCode: number = this.res.statusCode): this {
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

  /**
   * Gets a shallow copy of the current response headers.
   *
   * @returns {http.OutgoingHttpHeaders} An object representing current response headers.
   *
   * @example
   * const headers = ctx.getHeaders();
   */
  public getHeaders(): http.OutgoingHttpHeaders {
    return this.res.getHeaders();
  }

  /**
   * Gets the value of a specific response header.
   *
   * @param {string} header - The case-insensitive name of the header.
   * @returns {string | undefined} The header value formatted as a string, or undefined if not set.
   *
   * @example
   * const contentType = ctx.getHeader('Content-Type');
   */
  public getHeader(header: string): string | undefined {
    const raw = this.res.getHeader(header);
    if (raw === undefined) return undefined;
    return Array.isArray(raw) ? raw.join(", ") : String(raw);
  }

  /**
   * Gets the raw value of a specific response header.
   *
   * Unlike `getHeader`, this returns the exact value type (string, array of strings, or number).
   *
   * @param {string} header - The name of the header.
   * @returns {string | number | string[] | undefined} The raw header value.
   *
   * @example
   * const setCookie = ctx.getRawHeader('Set-Cookie');
   */
  public getRawHeader(header: string): string | number | string[] | undefined {
    return this.res.getHeader(header);
  }

  /**
   * Sets a response header key and value.
   *
   * Throws a HeadersSentError if response headers have already been sent to the client.
   *
   * @param {string} key - The response header name.
   * @param {string | number | readonly string[]} value - The response header value.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.setHeader('X-Powered-By', 'Volten');
   */
  public setHeader(key: string, value: string | number | readonly string[]): this {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.setHeader(key, value);
    return this;
  }

  /**
   * Removes a response header that was previously set.
   *
   * Throws a HeadersSentError if response headers have already been sent to the client.
   *
   * @param {string} key - The response header name to remove.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.removeHeader('X-Unwanted-Header');
   */
  removeHeader(key: string): this {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.removeHeader(key);
    return this;
  }

  /**
   * Flushes the response headers to the client immediately.
   *
   * Throws a HeadersSentError if response headers have already been sent to the client.
   *
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.flushHeaders();
   */
  flushHeaders(): this {
    if (this.res.headersSent) {
      throw new HeadersSentError();
    }
    this.res.flushHeaders();
    return this;
  }

  /**
   * Sets a cookie in the response headers.
   *
   * Appends or creates the `Set-Cookie` header with the serialized cookie name, value, and options.
   *
   * @param {string} name - The name of the cookie.
   * @param {string} value - The value of the cookie.
   * @param {CookieOptions} [options={}] - Optional cookie attributes like expiration, domain, security, path, etc.
   * @returns {this} The context instance for chaining.
   *
   * @example
   * ctx.setCookie('session', 'abc-123', { httpOnly: true, secure: true });
   */
  public setCookie(name: string, value: string, options: CookieOptions = {}): this {
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
