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
    if (!ctx.inited) {
      return;
    }
    ctx.reset();
    this.availableContexts.push(ctx);
  }

  resetEdgeCtx(ctx: EdgeRequestContext) {
    if (!ctx.inited) {
      return;
    }
    ctx.reset();
    this.availableEdgeContexts.push(ctx);
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
    this.adaptiveEngine = new AdaptiveEngine(this.AppOptions.adaptiveTriage);
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
        if (!this.AppOptions.noLogs) {
          console.error(err);
        }
        status = 500;
        body = "Internal Server Error";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
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
          if (!this.AppOptions.noLogs) {
            console.warn(
              `[Volten Framework Warning]: Custom error handler returned without terminating the response. Falling back to default handler.`,
            );
          }
          this.executeFallback(error, ctx);
        }
      } catch (customHandlerError) {
        if (!this.AppOptions.noLogs) {
          console.error("Custom error handler crashed:", customHandlerError);
        }
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
      if (!this.AppOptions.noLogs) {
        console.error("Critical failure in core errorHandler:", finalError);
      }
      if (ctx.runtime === "node") {
        const res = ctx.res;
        if (res !== null && !res.destroyed) {
          res.destroy();
          this.resetCtx(ctx);
        }
      } else {
        const edgeCtx = ctx as EdgeRequestContext;
        if (!edgeCtx.sent) {
          edgeCtx.send("Internal Server Error", 500);
        }
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

  private async handleRequest(ctx: RequestContext) {
    const preflightHandler = this.getPreflightHandler();
    if (preflightHandler !== null) {
      const result = preflightHandler(ctx);
      if (result instanceof Promise) {
        await result.catch((err: unknown) => this.handleError(err, ctx));
      }
      if (ctx.sent) {
        return;
      }
    }

    await ctx.routePath().catch((err: unknown) => {
      void this.handleError(err, ctx);
      return;
    });
    const route = ctx._route;
    if (route === null) return;

    const handlerChain = route.composeChain;
    const result = handlerChain(ctx);
    if (result instanceof Promise) {
      result.catch((err: unknown) => this.handleError(err, ctx));
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
  listen(...args: Parameters<http.Server["listen"]>): http.Server {
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
            const parsed = new URL(request.url);
            urlPath = parsed.pathname;
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

      let ctx = this.availableEdgeContexts.pop();
      if (ctx === undefined) {
        ctx = new EdgeRequestContext();
      }

      ctx.init(this, request, env, executionCtx);

      try {
        const preflightHandler = this.getPreflightHandler();
        if (preflightHandler !== null) {
          const result = preflightHandler(ctx);
          if (result instanceof Promise) {
            await result.catch((err: unknown) => this.handleError(err, ctx));
          }
          if (ctx.sent) {
            return await ctx._edgeResponsePromise;
          }
        }

        await ctx.routePath().catch((err: unknown) => {
          void this.handleError(err, ctx);
        });

        if (ctx.sent) {
          return await ctx._edgeResponsePromise;
        }

        const route = ctx._route;
        if (route === null) {
          return new Response("Not Found", { status: 404 });
        }

        const handlerChain = route.composeChain;
        const result = handlerChain(ctx);
        if (result instanceof Promise) {
          await result.catch((err: unknown) => this.handleError(err, ctx));
        }

        const resObj = await ctx._edgeResponsePromise;
        return resObj;
      } catch (err) {
        await this.handleError(err, ctx);
        return await ctx._edgeResponsePromise;
      } finally {
        if (ctx._edgeBody instanceof ReadableStream) {
          // Do not recycle immediately if body is a readable stream to allow deferred reading
        } else {
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
    this.handleRequest(ctx).catch(async (err: unknown) => {
      await this.handleError(err, ctx);
    });
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
  public async close(...args: Parameters<http.Server["close"]>) {
    this.acceptIncomming = false;
    this.adaptiveEngine.close();

    const timeoutMs = 10000;
    const startTime = Date.now();
    while (this.availableContexts.length < this.poolSize) {
      if (Date.now() - startTime > timeoutMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!this.server.listening) {
      if (typeof args[0] === "function") {
        args[0](new Error("ERR_SERVER_NOT_RUNNING: Server is not running."));
      }
      return;
    }

    return new Promise<void>((resolve) => {
      this.server.close((err) => {
        if (typeof args[0] === "function") {
          args[0](err);
        }
        resolve();
      });
    });
  }
}
