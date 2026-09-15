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
import { RequestContext, NodeRequestContext, EdgeRequestContext } from "../utils/requestCtx.ts";
import { JitCache } from "../utils/jitCache.ts";
import { PayloadTooLargeError, VoltenError } from "./errors.ts";
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
  private availableContexts: NodeRequestContext[];
  private availableEdgeContexts: EdgeRequestContext[];
  private poolIndex: number = 0;
  private poolSize: number = 2048;
  public JITCache: JitCache = new JitCache();
  protected tree: RouteTree;
  customErrorHandler: ErrorHandler | null = null;
  public serverStaticMap: string | null = null;
  public AppOptions = DefaultVoltenOptions;
  public static readonly EMPTY_OBJECT = Object.freeze({});

  public parseBody = parseBody.bind(this);
  public parseMultipartStream = parseMultipartStream.bind(this);
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

  resetCtx(ctx: NodeRequestContext) {
    if (ctx.inited) {
      ctx.reset();
      this.availableContexts.push(ctx);
    }
  }

  resetEdgeCtx(ctx: EdgeRequestContext) {
    if (ctx.inited) {
      ctx.reset();
      this.availableEdgeContexts.push(ctx);
    }
  }

  /**
   * Creates an instance of the Volten application.
   *
   * @param {VoltenAppOptions<CustomLevels>} [options={}] - App options including port, SSL certs, pool size, body limit, and logging configs.
   */
  constructor(options: VoltenAppOptions<CustomLevels> = {}) {
    super();
    Object.assign(this.AppOptions, options);
    const serverOptions =
      this.AppOptions.https !== undefined ? { https: this.AppOptions.https } : {};
    this.server = createServer(serverOptions, this.onRequest.bind(this));
    this.poolSize = this.AppOptions.RequestPoolSize;
    this.tree = new RouteTree(this.AppOptions.caseInsensitive);
    this.onRequest = this.onRequest.bind(this);
    this.logger = createLogger(this.AppOptions.loggerOptions) as Logger<CustomLevels>;
    this.adaptiveEngine = new AdaptiveEngine(this.AppOptions.adaptiveTriage, this.logger);
    this.availableContexts = [];
    this.availableEdgeContexts = [];
    for (let i = 0; i < this.poolSize; i++) {
      this.availableContexts.push(new NodeRequestContext());
      this.availableEdgeContexts.push(new EdgeRequestContext());
    }
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
      case "ERR_METHOD_NOT_ALLOWED":
        status = 405;
        body = err.message !== "" ? err.message : "Method Not Allowed";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_NOT_FOUND":
        status = 404;
        body = err.message !== "" ? err.message : "Not Found";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "SERVICE_UNAVAILABLE":
        status = 503;
        body = err.message !== "" ? err.message : "Service Unavailable";
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
      const edgeCtx = ctx as EdgeRequestContext;
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
        this.resetCtx(ctx);
      } else {
        const edgeCtx = ctx as EdgeRequestContext;
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
    const ctx = this.availableContexts.pop();
    if (ctx == undefined) {
      res.setHeader("Connection", "close");
      res.writeHead(503, SERVICE_UNAVAILABLE_HEADERS);
      res.end(SERVICE_UNAVAILABLE_BUF);
      return null;
    }
    this.poolIndex = (this.poolIndex + 1) % this.poolSize;

    ctx.init(this, req, res);
    if (!ctx.inited) {
      return null;
    }
    return ctx;
  }

  private handleRequest(ctx: RequestContext): void {
    // 1. Preflight execution
    const preflightHandler = this.getPreflightHandler();
    if (preflightHandler !== null) {
      try {
        const result = preflightHandler(ctx);
        if (typeof (result as Promise<unknown> | undefined)?.then === "function") {
          (result as Promise<unknown>)
            .then(() => {
              if (!ctx.sent) this.executeRouting(ctx);
            })
            .catch((err: unknown) => this.handleError(err, ctx));
          return;
        }
      } catch (err: unknown) {
        void this.handleError(err, ctx);
        return;
      }

      if (ctx.sent) return;
    }

    this.executeRouting(ctx);
  }

  private executeRouting(ctx: RequestContext): void {
    // 2. Route matching (Sync fast-path, async fallback)
    try {
      const routeResult = ctx.routePath();
      if (typeof (routeResult as Promise<unknown> | undefined)?.then === "function") {
        (routeResult as Promise<unknown>)
          .then(() => {
            this.executeChain(ctx);
          })
          .catch((err: unknown) => this.handleError(err, ctx));
        return;
      }
    } catch (err: unknown) {
      void this.handleError(err, ctx);
      return;
    }

    this.executeChain(ctx);
  }

  private executeChain(ctx: RequestContext): void {
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
        (result as Promise<unknown>).catch((err: unknown) => this.handleError(err, ctx));
      }
    } catch (err: unknown) {
      void this.handleError(err, ctx);
    }
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
  /* eslint-disable @typescript-eslint/unified-signatures, @typescript-eslint/no-explicit-any */
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
  listen(options: import("net").ListenOptions, listeningListener?: () => void): http.Server;
  listen(handle: any, backlog?: number, listeningListener?: () => void): http.Server;
  listen(handle: any, listeningListener?: () => void): http.Server;
  /* eslint-enable @typescript-eslint/unified-signatures, @typescript-eslint/no-explicit-any */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listen(...args: any[]): http.Server {
    if (this.server.listening) {
      const lastArg = args[args.length - 1] as unknown;
      if (typeof lastArg === "function") {
        process.nextTick(lastArg);
      }
      return this.server;
    }

    this.tree.clear();
    this.compilePreflightHandler();
    this.register(this);
    this.tree.createMatchPath();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.server.listen(...args);
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
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }
        }
      }

      const ctx = this.availableEdgeContexts.pop() ?? new EdgeRequestContext();
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
          });
          res.end("503 Service Unavailable: Server at capacity");
          req.socket.destroy();
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
    res.on("close", () => {
      this.resetCtx(ctx);
    });
    try {
      this.handleRequest(ctx);
    } catch (err: unknown) {
      void this.handleError(err, ctx);
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
    while (this.availableContexts.length < this.poolSize) {
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
