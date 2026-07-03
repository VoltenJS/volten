import http from "http";
import fs from "fs";
import {
  VoltenHandler,
  PreflightHandler,
  ErrorHandler,
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
import { RouteTree } from "../utils/routetree.ts";
import { RequestContext } from "../utils/requestctx.ts";
import { JitCache } from "../utils/jitcache.ts";
import { VoltenError } from "./errors.ts";
import { parseBody, parseMultipartStream } from "../utils/bodyparser.ts";

export class App {
  private availableContexts: RequestContext[];
  private poolIndex: number = 0;
  private poolSize: number = 2048;
  public JITCache: JitCache = new JitCache(500);
  protected middleware: VoltenHandler[] = [];
  protected tree: RouteTree;
  customErrorHandler: ErrorHandler | null = null;
  public serverStaticMap: string | null = null;
  public AppOptions: Required<VoltenAppOptions> = DeafultVoltenOptions;
  public static readonly EMPTY_OBJECT = Object.freeze({});

  public parseBody = parseBody.bind(this);
  public parseMultipartStream = parseMultipartStream.bind(this);
  public server = http.createServer(this.onRequest.bind(this));
  private acceptIncomming = true;

  private handleUncaught = (err: any) => {
    if (!this.AppOptions.noLogs) console.error(err);
  };
  private handleRejection = (err: any) => {
    if (!this.AppOptions.noLogs) console.error(err);
  };

  static(folderPath: string) {
    const absolutePath = fs.existsSync(folderPath)
      ? folderPath
      : fs.existsSync(`./${folderPath}`)
        ? `./${folderPath}`
        : null;
    if (!absolutePath) {
      throw new Error(`Directory not found: ${folderPath}`);
    }
    this.serverStaticMap = absolutePath;
  }

  resetCtx(ctx: RequestContext) {
    ctx.reset();
    this.availableContexts.push(ctx);
  }

  constructor(options: VoltenAppOptions = {}) {
    Object.assign(this.AppOptions, options);
    this.poolSize = this.AppOptions.RequestPoolSize;
    this.tree = new RouteTree(this.AppOptions.caseInsensitive);
    this.onRequest = this.onRequest.bind(this);
    this.availableContexts = [];
    for (let i = 0; i < this.poolSize; i++) {
      this.availableContexts.push(new RequestContext());
    }
    process.on("uncaughtException", this.handleUncaught);
    process.on("unhandledRejection", this.handleRejection);
  }

  //#region Routing Functions

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

  registerRoute(
    method: string,
    path: string,
    options: Required<RouteOptions>,
    ...handlers: VoltenHandler[]
  ) {
    const methodUpper = method.toUpperCase();
    const routeHandlers = this.middleware.concat(handlers);
    const routeData: RouteData = [methodUpper, path, routeHandlers, options];
    this.tree.addPath(...routeData);
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
    this.registerRoute("GET", path, options, ...routeHandlers);
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
    this.registerRoute("POST", path, options, ...routeHandlers);
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
    this.registerRoute("PATCH", path, options, ...routeHandlers);
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
    this.registerRoute("PUT", path, options, ...routeHandlers);
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
    this.registerRoute("DELETE", path, options, ...routeHandlers);
  }

  getRoute(method: string, path: string, ctx: RequestContext): PathData | null {
    return this.tree.matchPath(method, path, ctx) || null;
  }

  getRouteTree(): RouteTree {
    return this.tree;
  }

  //#endregion
  //#region Middleware & Internal Functions

  use(...fns: VoltenHandler[]): this {
    this.middleware.push(...fns);
    return this;
  }

  private errorHandler: ErrorHandler = (err, ctx) => {
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
        ctx.req!.socket.destroy();
        break;
      default:
        if (!this.AppOptions.noLogs) {
          console.log(err);
        }
        status = 500;
        body = err.message || "Internal Server Error";
        headers = {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        };
        break;
    }

    if (!ctx.headersSent) {
      res.writeHead(status, headers);
      res.end(body);
    } else {
      res.destroy();
    }
  };

  private preflightHandlers: PreflightHandler[] = [];
  private preflightHandler: PreflightHandler | null = null;

  public async handleError(err: unknown, ctx: RequestContext): Promise<void> {
    const error = err instanceof VoltenError ? err : VoltenError.from(err);
    const res = ctx.res!;

    const customHandler = this.customErrorHandler;

    if (customHandler) {
      try {
        await customHandler(error, ctx);
        if (!res.writableEnded && !res.destroyed) {
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

  private getPreflightHandler() {
    return this.preflightHandler;
  }

  public onError(fn: ErrorHandler) {
    this.customErrorHandler = fn;
  }

  public clearErrorHandler() {
    this.customErrorHandler = null;
  }

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
    const preflightHandler = this.getPreflightHandler();
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
      this.handleError(err, ctx);
      return;
    });
    const route = ctx.route;
    if (!route) return;

    const handlerChain = route.composeChain;
    const result = handlerChain(ctx);
    if (result instanceof Promise) {
      result.catch((err: unknown) => this.handleError(err, ctx));
    }
  }

  listen(port: number, cb?: () => void): http.Server {
    const server = http.createServer(this.onRequest);
    this.compilePreflightHandler();
    server.listen(port, "0.0.0.0", 16384, cb);
    return server;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.acceptIncomming) {
      req.socket.destroy();
    }
    const limit = this.AppOptions.bodyLimit;

    const clHeader = req.headers["content-length"];
    if (clHeader) {
      const contentLength = parseInt(clHeader, 10);
      if (contentLength > limit) {
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

  public close() {
    this.acceptIncomming = false;
    const awaitFinish = setInterval(() => {
      if (this.poolSize - this.availableContexts.length === 0) {
        awaitFinish.close();
        this.server.close();
        process.exit(0);
      }
    }, 100);
    process.off("uncaughtException", this.handleUncaught);
    process.off("unhandledRejection", this.handleRejection);
  }
}
