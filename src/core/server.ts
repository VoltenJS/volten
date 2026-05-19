import http from "http";
import fs from "fs";
import {
  VoltenHandler,
  PreflightHandler,
  GenericErrorHandler,
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
  RawErrorHandler,
} from "./types.ts";
import { compileMiddlewareChain } from "./compose.ts";
import { RouteTree } from "../utils/routetree.ts";
import { RequestContext } from "../utils/requestctx.ts";
import { JitCache } from "../utils/jitcache.ts";

class HostScope {
  constructor(
    private app: App,
    private host: string,
    private HostOptions: Required<VoltenAppOptions>,
  ) {}

  static(folderPath: string) {
    this.app.static(folderPath, this.host);
  }

  use(...fns: VoltenHandler[]): this {
    for (const fn of fns) {
      this.app.use(fn, this.host, this.HostOptions);
    }
    return this;
  }

  private identifyParamType(
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): { options: Required<RouteOptions>; routeHandlers: VoltenHandler[] } {
    const isOptions = typeof arg2 === "object" && arg2 !== null;
    const options = (isOptions ? { ...arg2 } : {}) as Required<RouteOptions>;
    options.bodyLimit = options.bodyLimit || this.app.AppOptions.bodyLimit;

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

  onError(handler: GenericErrorHandler) {
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
  public compiledStorage: Map<string, Function> = new Map();
  // To-Do: Make this customizable by dev
  public JITCache: JitCache = new JitCache(500);
  protected middleware: VoltenHandler[] = [];
  protected currentHost: string | null = null;
  // Check if it would be more efficient to seperate by method here instead of in RouteTree
  protected routes: Map<string, HostData> = new Map();
  private hostErrorHandlers: Record<string, GenericErrorHandler> =
    Object.create(null);
  private hostPreflightHandlers: Record<string, PreflightHandler> =
    Object.create(null);
  public serverStaticMap: Map<string, string> = new Map();
  public AppOptions: Required<VoltenAppOptions> = DeafultVoltenOptions;
  private static readonly EMPTY_OBJECT = Object.freeze({});

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
    options.bodyLimit = options.bodyLimit || 0;
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

  public async parseBody(
    ctx: RequestContext,
    text: boolean = false,
    limit = this.getSafeHost(ctx.host)?.hostOptions.bodyLimit ||
      this.AppOptions.bodyLimit,
  ): Promise<any> {
    const { req, res } = ctx;

    // 1. Fast-path: Check Content-Length before allocating promise/heap space
    const contentLengthHeader = req.headers["content-length"];
    if (contentLengthHeader !== undefined) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (contentLength > limit) {
        res
          .writeHead(413, PAYLOAD_TOO_LARGE_HEADERS)
          .end(PAYLOAD_TOO_LARGE_BUF);
        req.socket.destroy();
        throw new Error("Payload Too Large");
      }
      if (contentLength === 0) {
        return App.EMPTY_OBJECT;
      }
    }

    return new Promise((resolve, reject) => {
      let receivedSize = 0;
      const chunks: Buffer[] = [];

      // 2. Stream Chunk Collector Loop
      const onData = (chunk: Buffer) => {
        receivedSize += chunk.length;

        if (receivedSize > limit) {
          cleanup();
          req.destroy();
          res
            .writeHead(413, PAYLOAD_TOO_LARGE_HEADERS)
            .end(PAYLOAD_TOO_LARGE_BUF);
          reject(new Error("Payload Too Large"));
          return;
        }

        chunks.push(chunk);
      };

      // 3. Complete Processing Payload Boundary
      const onEnd = () => {
        cleanup();

        if (chunks.length === 0) {
          return resolve(App.EMPTY_OBJECT);
        }

        const rawBody = Buffer.concat(chunks, receivedSize).toString("utf8");
        const contentType = req.headers["content-type"] || "";
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

      // Clean up event listeners explicitly to prevent heap memory line leaks
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

  private defaultErrorHandler: RawErrorHandler = (err, res) => {
    console.error("Volten Route Error:", err);
    if (!res.headersSent) {
      res.writeHead(500, INTERNAL_SERVER_ERROR_HEADERS);
      res.end(INTERNAL_SERVER_ERROR_BUF);
    } else {
      res.destroy();
    }
  };

  private errorMiddleware: GenericErrorHandler = (err, ctx) => {
    console.error("Volten Route Error:", err);
    const res = ctx.res;
    if (!ctx.inited) return;
    if (!res.headersSent) {
      res.writeHead(500, INTERNAL_SERVER_ERROR_HEADERS);
      res.end(INTERNAL_SERVER_ERROR_BUF);
    } else {
      res.destroy();
    }
  };

  private preflightHandler: PreflightHandler | null = null;

  public handleError(err: any, res: http.ServerResponse, ctx: RequestContext) {
    const errorHandler =
      this.hostErrorHandlers[ctx.host] || this.hostErrorHandlers["**"];
    return errorHandler
      ? errorHandler(err, ctx)
      : this.errorMiddleware(err, ctx);
  }

  private getPreflightHandler(host: string) {
    const preflightHandler =
      this.hostPreflightHandlers[host] || this.hostPreflightHandlers["**"];
    return preflightHandler || this.preflightHandler || null;
  }

  public onError(fn: GenericErrorHandler, host?: string) {
    if (host) {
      this.hostErrorHandlers[host] = fn;
      return;
    }
    this.errorMiddleware = fn;
  }

  public preflight(fn: PreflightHandler, host?: string) {
    if (host) {
      this.hostPreflightHandlers[host] = fn;
      return;
    }
    this.preflightHandler = fn;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const ctx = this.availableContexts.pop();
    if (!ctx) {
      res.writeHead(503, SERVICE_UNAVAILABLE_HEADERS);
      res.end(SERVICE_UNAVAILABLE_BUF);
      return;
    }
    this.poolIndex = (this.poolIndex + 1) % this.poolSize;

    ctx.init(this, req, res);
    if (!ctx.inited) {
      return;
    }
    const route = ctx.route;

    // Use a pre-bound 404 handler to avoid creating a new function every time
    const handlerChain = route.composeChain;
    try {
      const result = handlerChain(ctx, undefined as any);
      if (result && typeof result.then === "function") {
        result.catch((err: any) => this.handleError(err, res, ctx));
      }
    } catch (err) {
      this.handleError(err, res, ctx);
      return;
    }
    //ctx.reset();
    res.on("finish", () => {
      ctx.reset();
      this.availableContexts.push(ctx);
    });

    // Only handle as promise if it actually returns one (Internal V8 optimization)
  }

  listen(port: number, cb?: () => void): http.Server {
    const server = http.createServer(this.onRequest);

    server.on("connection", (socket) => {
      socket.setNoDelay(true);
    });

    server.listen(port, "0.0.0.0", 16384, cb);
    return server;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const preflightHandler = this.getPreflightHandler(req.headers.host || "");
    if (preflightHandler) {
      try {
        const result = preflightHandler(req, res);
        if (result && typeof result.then === "function") {
          result.catch((err: Error) => this.defaultErrorHandler(err, res));
        }
      } catch (err: any) {
        this.defaultErrorHandler(err, res);
        return;
      }
      if (res.headersSent) {
        return;
      }
    }
    const host = req.headers.host || "";
    const hostConfig = this.getSafeHost(host);
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
    this.handleRequest(req, res);
  }
}
