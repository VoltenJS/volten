import http from "http";
import https from "https";
import fs from "fs";
import type {
  PreflightHandler,
  ErrorHandler,
  DefaultErrorHandler,
  PathData,
  VoltenAppOptions,
  Logger,
  CustomLoggerOptions,
  MultipartPart,
} from "./types.ts";
import {
  DefaultVoltenOptions,
  SERVICE_UNAVAILABLE_BUF,
  SERVICE_UNAVAILABLE_HEADERS,
  INTERNAL_SERVER_ERROR_BUF,
  INTERNAL_SERVER_ERROR_HEADERS,
  PAYLOAD_TOO_LARGE_BUF,
  PAYLOAD_TOO_LARGE_HEADERS,
} from "./types.ts";
import { RouteTree } from "../utils/routeTree.ts";
import {
  RequestContext,
  NodeRequestContext,
  EdgeRequestContext,
  NodeContextStorage,
  EdgeContextStorage,
} from "../utils/requestCtx.ts";
import { JitCache } from "../utils/jitCache.ts";
import { MethodNotAllowedError, PayloadTooLargeError, VoltenError } from "./errors.ts";
import { parseBody, parseMultipartStream } from "../utils/bodyParser.ts";
import { createServer } from "../utils/createServer.ts";
import { Router } from "./router.ts";
import { createLogger } from "../utils/logger.ts";
import { AdaptiveEngine } from "../utils/adaptiveEngine.ts";
import { buildDevErrorPage, isDevMode } from "../utils/devErrorPage.ts";

/**
 * The main Volten Application class.
 *
 * Inherits routing capabilities from the `Router` class and manages the HTTP/HTTPS server,
 * request pool, error handling, JIT response compilation/serialization caching, and logging.
 *
 * @template CustomLevels - Type defining custom logger levels.
 */
export class App<CustomLevels extends string = never> extends Router {
  private availableStorage: NodeContextStorage[];
  private availableEdgeStorage: EdgeContextStorage[];
  private poolIndex: number = 0;
  private nodeContextsCreated: number = 0;
  private tokenCounter: number = 0;

  private poolSize: number = 1024;
  /** Contexts currently owned by an in-flight request (including disconnected-but-unsettled ones). */
  private activeContexts: number = 0;
  public JITCache: JitCache = new JitCache();
  protected tree: RouteTree;
  customErrorHandler: ErrorHandler | null = null;
  public serverStaticMap: string | null = null;
  public AppOptions: Required<VoltenAppOptions<CustomLevels>>;
  public static readonly EMPTY_OBJECT = Object.freeze({});

  public parseBody = (
    ctx: RequestContext,
    text: boolean = false,
    limitOptional?: number,
  ): Promise<unknown> => parseBody.call(this, ctx, text, limitOptional);
  public parseMultipartStream = (
    ctx: RequestContext,
  ): AsyncGenerator<MultipartPart, void, unknown> => parseMultipartStream(ctx);
  public server: http.Server | https.Server;
  private acceptIncomming = true;
  public logger: Logger<CustomLevels>;
  public adaptiveEngine: AdaptiveEngine;

  /**
   * Configures a custom logger with the specified levels and formats.
   *
   * @param {CustomLoggerOptions<NewLevels>} options - Configuration options for the new logger.
   * @returns {Logger<NewLevels>} The newly configured logger instance.
   *
   * @example
   * app.configLogger({
   *   levels: { debug: 0, info: 1 },
   *   // ...
   * });
   */
  public configLogger<NewLevels extends string = never>(
    options: CustomLoggerOptions<NewLevels>,
  ): Logger<NewLevels> {
    const newLogger = createLogger(options);
    this.logger = newLogger as unknown as Logger<CustomLevels>;
    return newLogger;
  }

  /**
   * Configures a directory for serving static files.
   *
   * @param {string} folderPath - The directory path (absolute or relative to project root) to serve files from.
   *
   * @example
   * app.static('public');
   */
  static(folderPath: string) {
    const absolutePath = fs.existsSync(folderPath)
      ? folderPath
      : fs.existsSync(`./${folderPath}`)
        ? `./${folderPath}`
        : null;
    if (absolutePath === null) {
      throw new Error(`Directory not found: ${folderPath}`);
    }
    this.serverStaticMap = absolutePath;
  }

  resetCtx(ctx: NodeRequestContext, recycle: boolean = true) {
    if (ctx.inited) {
      ctx.inited = false;
      const storage = ctx._storage;
      if (storage.activeToken === ctx.token) {
        storage.reset();
        ctx.invalidate();
        if (recycle) this.availableStorage.push(storage);
      }
    }
  }

  resetEdgeCtx(ctx: EdgeRequestContext) {
    if (ctx.inited) {
      ctx.inited = false;
      const storage = ctx._storage;
      if (storage.activeToken === ctx.token) {
        storage.reset();
        ctx.invalidate();
        this.availableEdgeStorage.push(storage);
      }
    }
  }

  /**
   * Creates an instance of the Volten application.
   *
   * @param {VoltenAppOptions<CustomLevels>} [options={}] - App options including port, SSL certs, pool size, body limit, and logging configs.
   */
  constructor(options: VoltenAppOptions<CustomLevels> = {}) {
    super();
    this.AppOptions = {
      ...DefaultVoltenOptions,
      ...options,
      multipart: { ...DefaultVoltenOptions.multipart, ...options.multipart },
      adaptiveTriage: { ...DefaultVoltenOptions.adaptiveTriage, ...options.adaptiveTriage },
      loggerOptions: { ...DefaultVoltenOptions.loggerOptions, ...options.loggerOptions },
    } as unknown as Required<VoltenAppOptions<CustomLevels>>;

    const opts = this.AppOptions;
    if (
      typeof opts.bodyLimit !== "number" ||
      opts.bodyLimit < 0 ||
      !Number.isSafeInteger(opts.bodyLimit)
    ) {
      throw new TypeError("Invalid bodyLimit");
    }
    if (
      typeof opts.RequestPoolSize !== "number" ||
      opts.RequestPoolSize <= 0 ||
      !Number.isSafeInteger(opts.RequestPoolSize)
    ) {
      throw new TypeError("Invalid RequestPoolSize");
    }
    if (
      typeof opts.shutdownTimeoutMs !== "number" ||
      opts.shutdownTimeoutMs < 0 ||
      !Number.isSafeInteger(opts.shutdownTimeoutMs)
    ) {
      throw new TypeError("Invalid shutdownTimeoutMs");
    }
    if (
      typeof opts.requestTimeoutMs !== "number" ||
      opts.requestTimeoutMs < 0 ||
      !Number.isSafeInteger(opts.requestTimeoutMs)
    ) {
      throw new TypeError("Invalid requestTimeoutMs");
    }
    const mp = opts.multipart;
    if (
      typeof mp.maxTotalBytes !== "number" ||
      mp.maxTotalBytes < 0 ||
      !Number.isSafeInteger(mp.maxTotalBytes)
    )
      throw new TypeError("Invalid multipart.maxTotalBytes");
    if (typeof mp.maxParts !== "number" || mp.maxParts < 0 || !Number.isSafeInteger(mp.maxParts))
      throw new TypeError("Invalid multipart.maxParts");
    if (typeof mp.maxFields !== "number" || mp.maxFields < 0 || !Number.isSafeInteger(mp.maxFields))
      throw new TypeError("Invalid multipart.maxFields");
    if (
      typeof mp.maxFieldSize !== "number" ||
      mp.maxFieldSize < 0 ||
      !Number.isSafeInteger(mp.maxFieldSize)
    )
      throw new TypeError("Invalid multipart.maxFieldSize");
    if (
      typeof mp.maxFileSize !== "number" ||
      mp.maxFileSize < 0 ||
      !Number.isSafeInteger(mp.maxFileSize)
    )
      throw new TypeError("Invalid multipart.maxFileSize");
    if (
      typeof mp.maxHeaderSize !== "number" ||
      mp.maxHeaderSize < 0 ||
      !Number.isSafeInteger(mp.maxHeaderSize)
    )
      throw new TypeError("Invalid multipart.maxHeaderSize");

    const serverOptions =
      this.AppOptions.https !== undefined
        ? {
            https: this.AppOptions.https,
            requestTimeout: this.AppOptions.requestTimeoutMs,
            headersTimeout: this.AppOptions.requestTimeoutMs,
          }
        : {
            requestTimeout: this.AppOptions.requestTimeoutMs,
            headersTimeout: this.AppOptions.requestTimeoutMs,
          };
    this.server = createServer(serverOptions, this.onRequest.bind(this));
    if ("requestTimeout" in this.server) {
      this.server.requestTimeout = this.AppOptions.requestTimeoutMs;
    }
    if ("headersTimeout" in this.server) {
      this.server.headersTimeout = this.AppOptions.requestTimeoutMs;
    }
    this.poolSize = this.AppOptions.RequestPoolSize;
    this.tree = new RouteTree(this.AppOptions.caseInsensitive);
    this.onRequest = this.onRequest.bind(this);
    this.logger = createLogger(this.AppOptions.loggerOptions);
    this.adaptiveEngine = new AdaptiveEngine(this.AppOptions.adaptiveTriage, this.logger);
    this.availableStorage = [];
    this.availableEdgeStorage = [];
    this.nodeContextsCreated = 0;
    this.tokenCounter = 0;
    // Lazily allocate context pools only when needed (e.g. upon first request)
  }

  /**
   * Matches the incoming HTTP method and path against the route tree to find a matching route.
   *
   * @param {string} method - HTTP request method (e.g. 'GET', 'POST').
   * @param {string} path - The request path.
   * @param {RequestContext} ctx - The current request context.
   * @returns {PathData | null} The matched route metadata, or null if no route matches.
   */
  getRoute(method: string, path: string, ctx: RequestContext): PathData | null {
    return this.tree.matchPath(method, path, ctx);
  }

  /**
   * Gets the underlying route tree structure containing all registered route paths.
   *
   * @returns {RouteTree} The RouteTree instance.
   */
  getRouteTree(): RouteTree {
    return this.tree;
  }

  //#endregion
  //#region Middleware & Internal Functions

  private errorHandler: DefaultErrorHandler = (err, ctx) => {
    let status = 500;
    let headers: Record<string, string | number> = {
      ...INTERNAL_SERVER_ERROR_HEADERS,
    };
    let body: string | Buffer = INTERNAL_SERVER_ERROR_BUF;
    switch (err.code) {
      case "ERR_PAYLOAD_TOO_LARGE":
        status = 413;
        headers = { ...PAYLOAD_TOO_LARGE_HEADERS };
        body = PAYLOAD_TOO_LARGE_BUF;
        break;
      case "ERR_METHOD_NOT_ALLOWED": {
        status = 405;
        body = err.message !== "" ? err.message : "Method Not Allowed";
        const allow = err instanceof MethodNotAllowedError ? err.allowedMethods.join(", ") : "";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          ...(allow !== "" ? { Allow: allow } : {}),
        };
        break;
      }
      case "ERR_NOT_FOUND":
        status = 404;
        body = err.message !== "" ? err.message : "Not Found";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_SERVICE_UNAVAILABLE":
      case "SERVICE_UNAVAILABLE":
        status = 503;
        body = err.message !== "" ? err.message : "Service Unavailable";
        headers = { ...SERVICE_UNAVAILABLE_HEADERS };
        if (typeof body === "string" && body !== "Service Unavailable") {
          headers["content-length"] = Buffer.byteLength(body);
        } else {
          body = SERVICE_UNAVAILABLE_BUF;
        }
        break;
      case "ERR_BAD_REQUEST":
        status = 400;
        body = err.message !== "" ? err.message : "Bad Request";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_UNSUPPORTED_MEDIA_TYPE":
        status = 415;
        body = err.message !== "" ? err.message : "Unsupported Media Type";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_SEND_AFTER_SENT":
        this.logger.warn(err);
        break;
      case "ERR_HEADERS_SENT":
        if (ctx.runtime === "node") {
          const res = ctx.res;
          if (res !== null) {
            res.destroy();
          }
          const reqNode = ctx.req as http.IncomingMessage;
          reqNode.socket.destroy();
        }
        break;

      default:
        this.logger.error(err);
        status = 500;
        body = "Internal Server Error";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
    }

    if (err.code !== "ERR_HEADERS_SENT") {
      const acceptHeader = ctx.headers["accept"];
      const acceptStr =
        (typeof acceptHeader === "string"
          ? acceptHeader
          : Array.isArray(acceptHeader)
            ? acceptHeader[0]
            : "") ?? "";

      if (acceptStr.includes("application/json")) {
        const errorMsg = isDevMode()
          ? (err.stack ?? err.message)
          : Buffer.isBuffer(body)
            ? body.toString("utf8")
            : body;
        body = JSON.stringify({ error: errorMsg, code: status });
        headers["content-type"] = "application/json; charset=utf-8";
        headers["content-length"] = Buffer.byteLength(body);
      } else if (status === 500 && ctx.runtime === "node" && acceptStr.includes("text/html")) {
        const devPage = buildDevErrorPage(err.cause instanceof Error ? err.cause : err);
        if (devPage !== null) {
          body = devPage;
          headers = {
            "content-type": "text/html; charset=utf-8",
            "content-length": Buffer.byteLength(body),
          };
        }
      }
    }

    if (ctx.runtime === "node") {
      const res = ctx.res;
      if (res !== null) {
        if (!ctx.headersSent) {
          res.writeHead(status, headers);
          res.end(body);
        } else {
          res.destroy();
        }
      }
    } else {
      const edgeCtx = ctx as unknown as import("../utils/requestCtx.ts").EdgeRequestContext;
      if (!edgeCtx.headersSent) {
        edgeCtx.statusCode = status;
        for (const [key, value] of Object.entries(headers)) {
          edgeCtx.setHeader(key, String(value));
        }
        edgeCtx.send(body);
      }
    }
  };

  private preflightHandlers: PreflightHandler[] = [];
  private preflightHandler: PreflightHandler | null = null;

  /**
   * Handles errors thrown during request preprocessing, routing, or middleware execution.
   *
   * Falls back to the custom error handler if registered; otherwise, executes the default handler.
   *
   * @param {unknown} err - The error instance.
   * @param {RequestContext} ctx - The associated request context.
   * @returns {Promise<void>} A promise resolving when the error is handled.
   */
  public async handleError(err: unknown, ctx: RequestContext): Promise<void> {
    const error = err instanceof VoltenError ? err : VoltenError.from(err);
    const customHandler = this.customErrorHandler;

    if (customHandler !== null) {
      try {
        await customHandler(error, ctx);
        const isNotEnded =
          ctx.runtime === "node"
            ? ctx.res !== null && !ctx.res.writableEnded && !ctx.res.destroyed
            : !ctx.sent;

        if (isNotEnded) {
          this.logger.warn(
            `[Volten Framework Warning]: Custom error handler returned without terminating the response. Falling back to default handler.`,
          );
          this.executeFallback(error, ctx);
        }
      } catch (customHandlerError) {
        this.logger.error("Custom error handler crashed:", customHandlerError);
        this.executeFallback(error, ctx);
      }
    } else {
      this.executeFallback(error, ctx);
    }
  }

  private executeFallback(error: VoltenError, ctx: RequestContext) {
    try {
      this.errorHandler(error, ctx);
    } catch (finalError) {
      this.logger.error("Critical failure in core errorHandler:", finalError);
      if (ctx.runtime === "node") {
        const res = ctx.res;
        if (res !== null && !res.destroyed) {
          res.destroy();
        }
        // Recycling happens in onRequest once the response has closed and the chain settled.
      } else {
        const edgeCtx = ctx as unknown as import("../utils/requestCtx.ts").EdgeRequestContext;
        if (!edgeCtx.sent) {
          edgeCtx.send("Internal Server Error", 500);
        }
        this.resetEdgeCtx(edgeCtx);
      }
    }
  }

  private getPreflightHandler() {
    return this.preflightHandler;
  }

  /**
   * Registers a custom application-wide error handler.
   *
   * @param {ErrorHandler} fn - Custom error handler function.
   *
   * @example
   * app.onError((err, ctx) => {
   *   ctx.status(500).json({ error: err.message });
   * });
   */
  public onError(fn: ErrorHandler) {
    this.customErrorHandler = fn;
  }

  /**
   * Clears the registered custom error handler, falling back to the default handler.
   */
  public clearErrorHandler() {
    this.customErrorHandler = null;
  }

  /**
   * Registers a preflight request handler.
   *
   * Preflight handlers run sequentially before any routing occurs for every incoming request.
   *
   * @param {PreflightHandler} fn - Preflight handler function.
   *
   * @example
   * app.preflight(async (ctx) => {
   *   ctx.setHeader('X-Response-Time', Date.now().toString());
   * });
   */
  public preflight(fn: PreflightHandler) {
    this.preflightHandlers.push(fn);
  }

  private compilePreflightHandler() {
    if (this.preflightHandlers.length === 0) {
      this.preflightHandler = null;
      return;
    }
    this.preflightHandler = async (ctx: RequestContext) => {
      try {
        for (const fn of this.preflightHandlers) {
          await fn(ctx);
        }
      } catch (err) {
        if (VoltenError.isVoltenError(err)) {
          return this.handleError(err, ctx);
        }
        throw err;
      }
    };
  }

  private createCtx(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): NodeRequestContext | null {
    let storage = this.availableStorage.pop();
    if (storage === undefined) {
      if (this.nodeContextsCreated < this.poolSize) {
        storage = new NodeContextStorage();
        this.nodeContextsCreated++;
      }
    }
    if (storage === undefined) {
      res.setHeader("Connection", "close");
      res.writeHead(503, SERVICE_UNAVAILABLE_HEADERS);
      res.end(SERVICE_UNAVAILABLE_BUF);
      return null;
    }
    this.poolIndex = (this.poolIndex + 1) % this.poolSize;

    const token = ++this.tokenCounter;
    storage.activeToken = token;
    storage.generation++;
    const ctx = new NodeRequestContext(storage, token);
    ctx.init(this, req, res);
    if (!ctx.inited) {
      return null;
    }
    return ctx;
  }

  /**
   * Runs the whole request pipeline. Returns a promise (or undefined when everything completed
   * synchronously) that settles only once preflight, routing and the full handler chain are done.
   * The pooled context must not be recycled before this settles.
   */
  private handleRequest(ctx: RequestContext): void | Promise<void> {
    // 1. Preflight execution
    const preflightHandler = this.getPreflightHandler();
    if (preflightHandler !== null) {
      try {
        const result = preflightHandler(ctx);
        if (typeof (result as Promise<unknown> | undefined)?.then === "function") {
          return (result as Promise<unknown>)
            .then(() => {
              if (!ctx.sent) return this.executeRouting(ctx);
              return undefined;
            })
            .catch((err: unknown) => this.handleError(err, ctx));
        }
      } catch (err: unknown) {
        return this.handleError(err, ctx);
      }

      if (ctx.sent) return;
    }

    return this.executeRouting(ctx);
  }

  private executeRouting(ctx: RequestContext): void | Promise<void> {
    // 2. Route matching (Sync fast-path, async fallback)
    try {
      const routeResult = ctx.routePath();
      if (typeof (routeResult as Promise<unknown> | undefined)?.then === "function") {
        return (routeResult as Promise<unknown>)
          .then(() => this.executeChain(ctx))
          .catch((err: unknown) => this.handleError(err, ctx));
      }
    } catch (err: unknown) {
      return this.handleError(err, ctx);
    }

    return this.executeChain(ctx);
  }

  private executeChain(ctx: RequestContext): void | Promise<void> {
    // 3. Handler chain execution
    const route = ctx._route;
    if (route === null) return;

    try {
      const result = route.composeChain(ctx);
      if (
        result !== null &&
        typeof result === "object" &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<unknown>).catch((err: unknown) =>
          this.handleError(err, ctx),
        ) as Promise<void>;
      }
    } catch (err: unknown) {
      return this.handleError(err, ctx);
    }
    return;
  }

  private shutdownHandlersAdded = false;
  private isShuttingDown = false;

  private setupGracefulShutdown() {
    if (this.shutdownHandlersAdded) return;
    this.shutdownHandlersAdded = true;

    const shutdown = (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      this.logger.info(`Received ${signal}. Starting graceful shutdown...`);

      this.acceptIncomming = false; // Stop accepting new requests? Actually Volten handles this gracefully? server.close() stops accepting new requests.

      const timeout = setTimeout(() => {
        this.logger.warn(
          `Shutdown timeout of ${this.AppOptions.shutdownTimeoutMs.toString()}ms exceeded. Forcing connection close.`,
        );
        if (
          "closeAllConnections" in this.server &&
          typeof this.server.closeAllConnections === "function"
        ) {
          this.server.closeAllConnections();
        }
      }, this.AppOptions.shutdownTimeoutMs);
      timeout.unref();

      this.server.close((err) => {
        clearTimeout(timeout);
        if (err !== undefined) {
          this.logger.error(`Error during shutdown: ${err.message}`);
        } else {
          this.logger.info("Graceful shutdown complete.");
        }
      });

      if (
        "closeIdleConnections" in this.server &&
        typeof this.server.closeIdleConnections === "function"
      ) {
        this.server.closeIdleConnections();
      }
    };

    try {
      if (process.getMaxListeners() <= process.listenerCount("SIGINT") + 1) {
        process.setMaxListeners(process.getMaxListeners() + 5);
      }
    } catch {
      // ignore
    }
    process.once("SIGINT", () => {
      shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      shutdown("SIGTERM");
    });
  }
  /**
   * Starts the HTTP/HTTPS server listening for incoming connections.
   *
   * Compiles registered route trees, preflight pipelines, and binds to the specified port.
   *
   * @param {...any[]} args - Arguments passed directly to the underlying Node.js server `listen` method.
   * @returns {http.Server | https.Server} The underlying Node.js Server instance.
   *
   * @example
   * app.listen(3000, () => {
   *   console.log('Server is running on port 3000');
   * });
   */
  /* eslint-disable @typescript-eslint/unified-signatures */
  listen(
    port?: number,
    hostname?: string,
    backlog?: number,
    listeningListener?: () => void,
  ): http.Server;
  listen(port?: number, hostname?: string, listeningListener?: () => void): http.Server;
  listen(port?: number, backlog?: number, listeningListener?: () => void): http.Server;
  listen(port?: number, listeningListener?: () => void): http.Server;
  listen(path: string, backlog?: number, listeningListener?: () => void): http.Server;
  listen(path: string, listeningListener?: () => void): http.Server;
  listen(handle: unknown, backlog?: number, listeningListener?: () => void): http.Server;
  listen(handle: unknown, listeningListener?: () => void): http.Server;
  /* eslint-enable @typescript-eslint/unified-signatures */

  listen(...args: unknown[]): http.Server {
    if (this.server.listening) {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === "function") {
        process.nextTick(lastArg);
      }
      return this.server;
    }

    this.tree.clear();
    this.compilePreflightHandler();
    this.register(this);
    this.tree.createMatchPath();
    this.setupGracefulShutdown();
    Object.freeze(this.AppOptions);
    Object.freeze(this.AppOptions.multipart);
    Object.freeze(this.AppOptions.adaptiveTriage);
    Object.freeze(this.AppOptions.loggerOptions);
    (this.server.listen as (...a: unknown[]) => http.Server)(...args);
    return this.server;
  }

  /**
   * Returns a fetch handler compatible with Web Fetch API / Edge environments.
   *
   * @returns {(request: Request, env?: unknown, executionCtx?: unknown) => Promise<Response>} The native fetch handler.
   */
  public createFetch(): (
    request: Request,
    env?: unknown,
    executionCtx?: unknown,
  ) => Promise<Response> {
    this.compilePreflightHandler();
    this.register(this);
    this.tree.createMatchPath();

    return async (request: Request, env?: unknown, executionCtx?: unknown): Promise<Response> => {
      if (this.adaptiveEngine.enabled) {
        this.adaptiveEngine.evaluateState();
        if (this.adaptiveEngine.state !== "NORMAL") {
          let urlPath = request.url;
          try {
            urlPath = new URL(request.url).pathname;
          } catch {
            const qIndex = urlPath.indexOf("?");
            if (qIndex !== -1) urlPath = urlPath.substring(0, qIndex);
          }
          const priority = this.tree.getRoutePriority(request.method, urlPath);
          if (this.adaptiveEngine.shouldDrop(priority)) {
            return new Response("503 Service Unavailable: Server at capacity", {
              status: 503,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Retry-After": "1",
              },
            });
          }
        }
      }

      const storage = this.availableEdgeStorage.pop() ?? new EdgeContextStorage();
      const token = ++this.tokenCounter;
      storage.activeToken = token;
      storage.generation++;
      const ctx = new EdgeRequestContext(storage, token);
      ctx.init(this, request, env, executionCtx);

      try {
        // 1. Synchronous-first Preflight
        const preflightHandler = this.getPreflightHandler();
        if (preflightHandler !== null) {
          const preResult = preflightHandler(ctx);
          if (
            preResult !== undefined &&
            typeof (preResult as Promise<unknown>).then === "function"
          ) {
            await (preResult as Promise<unknown>);
          }
          if (ctx.sent) {
            return await ctx._edgeResponsePromise;
          }
        }

        // 2. Synchronous-first Route Matching
        const routeResult = ctx.routePath();
        if (typeof (routeResult as Promise<unknown> | undefined)?.then === "function") {
          await (routeResult as Promise<unknown>);
        }

        if (ctx.sent) {
          return await ctx._edgeResponsePromise;
        }

        const route = ctx._route;
        if (route === null) {
          return new Response("Not Found", { status: 404 });
        }

        // 3. Synchronous-first Handler Chain
        const chainResult = route.composeChain(ctx);
        if (
          chainResult !== undefined &&
          typeof (chainResult as Promise<unknown>).then === "function"
        ) {
          await (chainResult as Promise<unknown>);
        }

        return await ctx._edgeResponsePromise;
      } catch (err: unknown) {
        const errorResult = this.handleError(err, ctx);
        if (typeof (errorResult as Promise<unknown>).then === "function") {
          await (errorResult as Promise<unknown>);
        }
        return await ctx._edgeResponsePromise;
      } finally {
        if (!(ctx._edgeBody instanceof ReadableStream)) {
          this.resetEdgeCtx(ctx);
        }
      }
    };
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.acceptIncomming) {
      req.socket.destroy();
      return;
    }

    if (this.adaptiveEngine.enabled) {
      this.adaptiveEngine.evaluateState();
      if (this.adaptiveEngine.state !== "NORMAL") {
        let urlPath = req.url ?? "/";
        const qIndex = urlPath.indexOf("?");
        if (qIndex !== -1) {
          urlPath = urlPath.substring(0, qIndex);
        }
        const priority = this.tree.getRoutePriority(req.method ?? "GET", urlPath);
        if (this.adaptiveEngine.shouldDrop(priority)) {
          res.writeHead(503, {
            "Content-Type": "text/plain; charset=utf-8",
            Connection: "close",
            "Retry-After": "1",
          });
          res.end("503 Service Unavailable: Server at capacity");
          return;
        }
      }
    }
    const limit = this.AppOptions.bodyLimit;
    const clHeader = req.headers["content-length"];
    if (clHeader !== undefined) {
      const contentLength = parseInt(clHeader, 10);
      if (contentLength > limit) {
        req.pause();
        this.errorHandler(new PayloadTooLargeError(limit.toString()), {
          req,
          res,
          runtime: "node",
          headers: req.headers,
        } as RequestContext);
        return;
      }
    }
    const ctx = this.createCtx(req, res);
    if (ctx === null) {
      return;
    }
    // Lifetime invariant: the context returns to the pool only after BOTH the response has
    // closed AND the handler chain has settled. A client disconnect alone never recycles it.
    const token = ctx.token;
    this.activeContexts++;
    let closed = false as boolean;
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    let detached = false;
    const release = () => {
      if (forceTimer !== null) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
      // token guards against a double release recycling storage a newer request owns
      if (ctx.token === token && ctx._storage.activeToken === token) {
        this.activeContexts--;
        let canReturnToPool = !detached;
        if (detached && settled && this.nodeContextsCreated < this.poolSize) {
          this.nodeContextsCreated++;
          canReturnToPool = true;
        }
        this.resetCtx(ctx, canReturnToPool);
      }
    };
    res.on("close", () => {
      if (closed) return;
      closed = true;
      if (settled) {
        ctx.disconnected = true;
        release();
        return;
      }
      if (!res.writableEnded) {
        ctx.disconnected = true;
        // Handler still running: the context is detached from pool accounting (a fresh context may
        // be created for new requests) and is discarded once it is released.
        detached = true;
        this.nodeContextsCreated--;
      }
      // Last-resort bound so a handler
      // that never settles cannot leak the slot forever (generation bump makes late access inert).
      const limit = this.AppOptions.requestTimeoutMs;
      if (limit > 0) {
        forceTimer = setTimeout(release, limit);
        forceTimer.unref();
      }
    });
    try {
      const pending = this.handleRequest(ctx);
      if (pending !== undefined && typeof pending.then === "function") {
        const onSettled = () => {
          settled = true;
          if (closed) release();
        };
        pending.then(onSettled, (err: unknown) => {
          this.logger.error("Unexpected request pipeline failure:", err);
          onSettled();
        });
      } else {
        settled = true;
        if (closed) release();
      }
    } catch (err: unknown) {
      void this.handleError(err, ctx);
      settled = true;
      if (closed) release();
    }
  }

  /**
   * Prints a beautifully formatted ASCII table of all registered routes, their HTTP methods,
   * middleware count, and priority to the console using the application logger.
   */
  public printRoutes(): void {
    const routes = this.getRegisteredRoutes();
    if (routes.length === 0) {
      this.logger.info("No routes registered.");
      return;
    }

    // Calculate column widths
    const maxMethodLen = Math.max(6, ...routes.map((r) => r.method.length));
    const maxPathLen = Math.max(4, ...routes.map((r) => r.path.length));
    const maxHandlersLen = 10;
    const maxPriorityLen = Math.max(8, ...routes.map((r) => r.priority.length));

    const totalWidth = maxMethodLen + maxPathLen + maxHandlersLen + maxPriorityLen + 13;
    const separator = "-".repeat(totalWidth);

    let output = `\n${separator}\n`;
    output += `| ${"METHOD".padEnd(maxMethodLen)} | ${"PATH".padEnd(maxPathLen)} | ${"MIDDLEWARE".padEnd(maxHandlersLen)} | ${"PRIORITY".padEnd(maxPriorityLen)} |\n`;
    output += `${separator}\n`;

    // Sort routes by path then method
    routes.sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.method.localeCompare(b.method);
    });

    for (const route of routes) {
      output += `| ${route.method.padEnd(maxMethodLen)} | ${route.path.padEnd(maxPathLen)} | ${route.handlersCount.toString().padEnd(maxHandlersLen)} | ${route.priority.padEnd(maxPriorityLen)} |\n`;
    }
    output += `${separator}\n`;

    console.info(output);
  }

  /**
   * Gracefully shuts down the HTTP/HTTPS server.
   *
   * Stops accepting new connections, waits for active connections in the request pool to complete
   * (up to a timeout limit), and closes the server.
   *
   * @param {...any[]} args - Arguments passed directly to the underlying Node.js server `close` method.
   * @returns {Promise<void>} A promise resolving when the server has successfully closed.
   *
   * @example
   * await app.close();
   */
  public async close(callback?: (err?: Error) => void): Promise<void> {
    this.acceptIncomming = false;
    this.adaptiveEngine.close();

    const timeoutMs = this.AppOptions.shutdownTimeoutMs;
    const startTime = Date.now();
    while (this.activeContexts > 0) {
      if (Date.now() - startTime > timeoutMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!this.server.listening) {
      if (typeof callback === "function") {
        callback(new Error("ERR_SERVER_NOT_RUNNING: Server is not running."));
      }
      return;
    }

    // Force close any hanging sockets that didn't finish gracefully
    if ("closeAllConnections" in this.server) {
      this.server.closeAllConnections();
    }

    return new Promise<void>((resolve) => {
      this.server.close((err) => {
        if (typeof callback === "function") {
          callback(err);
        }
        resolve();
      });
    });
  }
}
