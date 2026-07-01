import http from "http";
import fs from "fs";
import {
  VoltenHandler,
  PreflightHandler,
  ErrorHandler,
  HostData,
  RouteData,
  PathData,
  VoltenAppOptions,
  RouteOptions,
  DeafultVoltenOptions,
  SERVICE_UNAVAILABLE_BUF,
  SERVICE_UNAVAILABLE_HEADERS,
  INTERNAL_SERVER_ERROR_BUF,
  INTERNAL_SERVER_ERROR_HEADERS,
  PAYLOAD_TOO_LARGE_BUF,
  PAYLOAD_TOO_LARGE_HEADERS,
} from "./types.ts";
import { compileMiddlewareChain } from "./compose.ts";
import { RouteTree } from "../utils/routetree.ts";
import { RequestContext } from "../utils/requestctx.ts";
import { JitCache } from "../utils/jitcache.ts";
import { VoltenError } from "./errors.ts";
import { parseBody, parseMultipartStream } from "../utils/bodyparser.ts";

class HostScope {
  constructor(
    private app: App,
    private host: string,
    private hostOptions: Required<VoltenAppOptions>,
  ) {
    this.app.createHost(host, hostOptions);
  }

  static(folderPath: string) {
    this.app.static(folderPath, this.host);
  }

  use(...fns: VoltenHandler[]): this {
    for (const fn of fns) {
      this.app.use(fn, this.host, this.hostOptions);
    }
    return this;
  }

  private identifyParamType(
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): { options: Required<RouteOptions>; routeHandlers: VoltenHandler[] } {
    const isOptions = typeof arg2 === "object" && arg2 !== null;
    const options = (isOptions ? { ...arg2 } : {}) as Required<RouteOptions>;
    options.bodyLimit = options.bodyLimit || null;

    const routeHandlers = isOptions
      ? handlers
      : [arg2 as VoltenHandler, ...handlers];

    return { options, routeHandlers };
  }

  get(path: string, ...handlers: VoltenHandler[]): void;
  get(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  get(
    path: string,
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2,
      ...handlers,
    );
    this.app.registerRoute(this.host, "GET", path, options, ...routeHandlers);
  }

  post(path: string, ...handlers: VoltenHandler[]): void;
  post(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  post(
    path: string,
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2,
      ...handlers,
    );
    this.app.registerRoute(this.host, "POST", path, options, ...routeHandlers);
  }

  patch(path: string, ...handlers: VoltenHandler[]): void;
  patch(
    path: string,
    options: RouteOptions,
    ...handlers: VoltenHandler[]
  ): void;
  patch(
    path: string,
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2,
      ...handlers,
    );
    this.app.registerRoute(this.host, "PATCH", path, options, ...routeHandlers);
  }

  put(path: string, ...handlers: VoltenHandler[]): void;
  put(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  put(
    path: string,
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2,
      ...handlers,
    );
    this.app.registerRoute(this.host, "PUT", path, options, ...routeHandlers);
  }

  delete(path: string, ...handlers: VoltenHandler[]): void;
  delete(
    path: string,
    options: RouteOptions,
    ...handlers: VoltenHandler[]
  ): void;
  delete(
    path: string,
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2,
      ...handlers,
    );
    this.app.registerRoute(
      this.host,
      "DELETE",
      path,
      options,
      ...routeHandlers,
    );
  }

  onError(handler: ErrorHandler) {
    this.app.onError(handler, this.host);
  }

  preflight(handler: PreflightHandler) {
    this.app.preflight(handler, this.host);
  }
}

export class App {
  private availableContexts: RequestContext[];
  private poolIndex: number = 0;
  private poolSize: number = 2048;
  // To-Do: Make this customizable by dev
  public JITCache: JitCache = new JitCache(500);
  protected middleware: VoltenHandler[] = [];
  protected currentHost: string | null = null;
  // Check if it would be more efficient to seperate by method here instead of in RouteTree
  protected routes: Map<string, HostData> = new Map();
  private hostErrorHandlers: Record<string, ErrorHandler> = Object.create(null);
  private hostPreflightHandlers: Record<string, PreflightHandler> =
    Object.create(null);
  customErrorHandler: ErrorHandler | null = null;
  public serverStaticMap: Map<string, string> = new Map();
  public AppOptions: Required<VoltenAppOptions> = DeafultVoltenOptions;
  public static readonly EMPTY_OBJECT = Object.freeze({});

  public parseBody = parseBody.bind(this);
  public parseMultipartStream = parseMultipartStream.bind(this);

  static(folderPath: string, host: string) {
    const absolutePath = fs.existsSync(folderPath)
      ? folderPath
      : fs.existsSync(`./${folderPath}`)
        ? `./${folderPath}`
        : null;
    if (!absolutePath) {
      throw new Error(`Directory not found: ${folderPath}`);
    }
    this.serverStaticMap.set(host, absolutePath);
  }

  resetCtx(ctx: RequestContext) {
    ctx.reset();
    this.availableContexts.push(ctx);
  }

  constructor(options: VoltenAppOptions = {}) {
    Object.assign(this.AppOptions, options);
    this.poolSize = this.AppOptions.RequestPoolSize;
    this.onRequest = this.onRequest.bind(this);
    this.availableContexts = [];
    for (let i = 0; i < this.poolSize; i++) {
      this.availableContexts.push(new RequestContext());
    }
  }

  //#region Routing Functions

  getHost(host: string): HostData {
    const hostData = this.routes.get(host);
    if (hostData) {
      return hostData;
    }
    this.routes.set(host, {
      tree: new RouteTree(this.AppOptions.caseInsensitive),
      middleware: [],
      immediate: new Map(),
      hostOptions: this.AppOptions,
    });
    return this.routes.get(host) as HostData;
  }

  createHost(host: string, options: Required<VoltenAppOptions>): void {
    if (this.routes.get(host)) return;
    this.routes.set(host, {
      tree: new RouteTree(options.caseInsensitive),
      middleware: [],
      immediate: new Map(),
      hostOptions: options,
    });
  }

  getSafeHost(host: string): HostData | null {
    const hostData = this.routes.get(host);
    if (hostData) {
      return hostData;
    }
    return null;
  }

  registerRoute(
    host: string,
    method: string,
    path: string,
    options: Required<RouteOptions>,
    ...handlers: VoltenHandler[]
  ) {
    const hostData = this.getHost(host);
    const methodUpper = method.toUpperCase();

    // Flatten the middleware chain for this route
    const routeMiddleware = this.middleware.concat(
      hostData.middleware,
      handlers,
    );
    const finalHandler = routeMiddleware.pop()!; // last handler
    const compiledChain = compileMiddlewareChain(routeMiddleware, finalHandler);
    const routeData: RouteData = [
      methodUpper,
      path,
      routeMiddleware,
      finalHandler,
      compiledChain,
      options,
    ];

    hostData.tree.addPath(...routeData);
  }

  getRoute(
    method: string,
    host: string,
    path: string,
    ctx: RequestContext,
  ): PathData | null {
    return this.routes.get(host)?.tree.matchPath(method, path, ctx) || null;
  }

  //#endregion
  //#region Middleware & Internal Functions
  host(host: string, options?: VoltenAppOptions): HostScope {
    if (host.endsWith("/")) {
      host = host.slice(0, -1);
    }
    if (options) {
      return new HostScope(this, host, { ...this.AppOptions, ...options });
    }
    return new HostScope(this, host, this.AppOptions);
  }

  use(
    fn: VoltenHandler,
    host?: string,
    hostOptions?: Required<VoltenAppOptions>,
  ): void {
    if (host) {
      const hostData: HostData = this.routes.get(host) ?? {
        tree: new RouteTree(
          hostOptions?.caseInsensitive || this.AppOptions.caseInsensitive,
        ),
        middleware: [],
        immediate: new Map(),
        hostOptions: hostOptions || this.AppOptions,
      };

      hostData.middleware.push(fn);
      this.routes.set(host, hostData);
      return;
    }
    this.middleware.push(fn);
  }

  private errorHandler: ErrorHandler = (err, ctx) => {
    // 1. Establish structural defaults based on the Volten Error Code
    let status = 500;
    let headers: Record<string, string | number> = {
      ...INTERNAL_SERVER_ERROR_HEADERS,
    };
    let body: string | Buffer = INTERNAL_SERVER_ERROR_BUF;
    const res = ctx.res!;
    switch (err.code) {
      case "ERR_PAYLOAD_TOO_LARGE":
        status = 413;
        headers = { ...PAYLOAD_TOO_LARGE_HEADERS };
        body = PAYLOAD_TOO_LARGE_BUF;
        break;
      case "ERR_METHOD_NOT_ALLOWED":
        status = 405;
        body = err.message || "Method Not Allowed";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_NOT_FOUND":
        status = 404;
        body = err.message || "Not Found";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "SERVICE_UNAVAILABLE":
        status = 503;
        body = err.message || "Service Unavailable";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
      case "ERR_HEADERS_SENT":
        ctx.res!.destroy();
        ctx.req!.destroy();
        ctx.req!.socket.destroy();
        break;
      default:
        if (!this.AppOptions.noLogs) {
          console.error("Volten Framework Error:", err);
        }
        status = 500;
        body = err.message || "Internal Server Error";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
    }

    // 3. Centralized Node.js Stream termination
    if (!ctx.headersSent) {
      res.writeHead(status, headers);
      res.end(body);
    } else {
      res.destroy();
    }
  };

  private preflightHandler: PreflightHandler | null = null;

  public async handleError(err: unknown, ctx: RequestContext): Promise<void> {
    const error = err instanceof VoltenError ? err : VoltenError.from(err);
    const res = ctx.res!;

    const customHandler =
      this.hostErrorHandlers[ctx.host] ||
      this.hostErrorHandlers["**"] ||
      this.customErrorHandler;

    if (customHandler) {
      try {
        await customHandler(error, ctx);
        if (!res.writableEnded && !res.destroyed) {
          if (!this.AppOptions.noLogs) {
            console.warn(
              `[Volten Framework Warning]: Custom error handler for host "${ctx.host}" ` +
                `returned without terminating the response. Falling back to default handler.`,
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

  private executeFallback(error: VoltenError, ctx: RequestContext): void {
    try {
      this.errorHandler(error, ctx);
    } catch (finalError) {
      if (!this.AppOptions.noLogs) {
        console.error("Critical failure in core errorHandler:", finalError);
      }
      if (ctx.res && !ctx.res.destroyed) {
        ctx.res.destroy();
      }
    }
  }

  private getPreflightHandler(host: string) {
    const preflightHandler =
      this.hostPreflightHandlers[host] || this.hostPreflightHandlers["**"];
    return preflightHandler || this.preflightHandler || null;
  }

  public onError(fn: ErrorHandler, host?: string) {
    if (host) {
      this.hostErrorHandlers[host] = fn;
      return;
    }
    this.customErrorHandler = fn;
  }

  public clearErrorHandler(host?: string) {
    if (host) {
      delete this.hostErrorHandlers[host];
      return;
    }
    this.customErrorHandler = null;
  }

  public preflight(fn: PreflightHandler, host?: string) {
    if (host) {
      this.hostPreflightHandlers[host] = fn;
      return;
    }
    this.preflightHandler = fn;
  }

  private createCtx(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): RequestContext | null {
    const ctx = this.availableContexts.pop();
    if (!ctx) {
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
    const preflightHandler = this.getPreflightHandler(ctx.host || "");
    if (preflightHandler) {
      const result = preflightHandler(ctx);
      if (result instanceof Promise) {
        await result.catch((err: VoltenError) => this.handleError(err, ctx));
      }
      if (ctx.sent) {
        return;
      }
    }

    await ctx.routePath().catch((err) => {
      //console.log("Route Path Error:", err);
      this.handleError(err, ctx);
      return;
    });
    const route = ctx.route;
    if (!route) return;

    // Use a pre-bound 404 handler to avoid creating a new function every time
    const handlerChain = route.composeChain;
    const result = handlerChain(ctx, () => {});
    if (result instanceof Promise) {
      result.catch((err: unknown) => this.handleError(err, ctx));
    }
  }

  listen(port: number, cb?: () => void): http.Server {
    const server = http.createServer(this.onRequest);

    /*server.on("connection", (socket) => {
      socket.setNoDelay(true);
    });*/

    server.listen(port, "0.0.0.0", 16384, cb);
    return server;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host || "";
    const hostConfig = this.getSafeHost(host) || this.getSafeHost("**");
    const limit =
      hostConfig?.hostOptions.bodyLimit || this.AppOptions.bodyLimit;

    // Handle Content-Length strictly
    const clHeader = req.headers["content-length"];
    if (clHeader) {
      const contentLength = parseInt(clHeader, 10);
      if (contentLength > limit) {
        //req.socket.destroy();
        req.pause();
        res.writeHead(413, PAYLOAD_TOO_LARGE_HEADERS);
        res.end(PAYLOAD_TOO_LARGE_BUF);
        req.socket.destroy();

        return;
      }
    }
    const ctx = this.createCtx(req, res);
    if (!ctx) {
      return;
    }
    this.handleRequest(ctx).catch(async (err) => {
      await this.handleError(err, ctx);
    });
  }
}
