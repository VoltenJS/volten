import http from "http";
import https from "https";
import fs from "fs";
import type { PreflightHandler, ErrorHandler, PathData, VoltenAppOptions } from "./types.ts";
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
import { RequestContext } from "../utils/requestCtx.ts";
import { JitCache } from "../utils/jitCache.ts";
import { VoltenError } from "./errors.ts";
import { parseBody, parseMultipartStream } from "../utils/bodyParser.ts";
import { createServer } from "../utils/createServer.ts";
import { Router } from "./router.ts";

export class App extends Router {
  private availableContexts: RequestContext[];
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

  private handleUncaught = (err: unknown) => {
    if (!this.AppOptions.noLogs) console.error(err);
  };
  private handleRejection = (err: unknown) => {
    if (!this.AppOptions.noLogs) console.error(err);
  };

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

  resetCtx(ctx: RequestContext) {
    if (!ctx.inited) {
      return;
    }
    ctx.reset();
    this.availableContexts.push(ctx);
  }

  constructor(options: VoltenAppOptions = {}) {
    super();
    Object.assign(this.AppOptions, options);
    const serverOptions =
      this.AppOptions.https !== undefined ? { https: this.AppOptions.https } : {};
    this.server = createServer(serverOptions, this.onRequest.bind(this));
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

  getRoute(method: string, path: string, ctx: RequestContext): PathData | null {
    return this.tree.matchPath(method, path, ctx);
  }

  getRouteTree(): RouteTree {
    return this.tree;
  }

  //#endregion
  //#region Middleware & Internal Functions

  private errorHandler: ErrorHandler = (err, ctx) => {
    let status = 500;
    let headers: Record<string, string | number> = {
      ...INTERNAL_SERVER_ERROR_HEADERS,
    };
    let body: string | Buffer = INTERNAL_SERVER_ERROR_BUF;
    const res = ctx.res;
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
        ctx.res.destroy();
        ctx.req.socket.destroy();
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
    const res = ctx.res;

    const customHandler = this.customErrorHandler;

    if (customHandler !== null) {
      try {
        await customHandler(error, ctx);
        if (!res.writableEnded && !res.destroyed) {
          if (!this.AppOptions.noLogs) {
            console.warn(
              `[Volten Framework Warning]: Custom error handler returned without terminating the response. Falling back to default handler.`,
            );
          }
          await this.executeFallback(error, ctx);
        }
      } catch (customHandlerError) {
        if (!this.AppOptions.noLogs) {
          console.error("Custom error handler crashed:", customHandlerError);
        }
        await this.executeFallback(error, ctx);
      }
    } else {
      await this.executeFallback(error, ctx);
    }
  }

  private async executeFallback(error: VoltenError, ctx: RequestContext): Promise<void> {
    try {
      await this.errorHandler(error, ctx);
    } catch (finalError) {
      if (!this.AppOptions.noLogs) {
        console.error("Critical failure in core errorHandler:", finalError);
      }
      if (!ctx.res.destroyed) {
        ctx.res.destroy();
        this.resetCtx(ctx);
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

  private createCtx(req: http.IncomingMessage, res: http.ServerResponse): RequestContext | null {
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

  listen(...args: Parameters<http.Server["listen"]>): http.Server {
    if (this.server.listening) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const lastArg = args[args.length - 1];
      if (typeof lastArg === "function") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        process.nextTick(lastArg);
      }
      return this.server;
    }

    this.compilePreflightHandler();
    this.register(this);
    this.server.listen(...args);
    return this.server;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.acceptIncomming) {
      req.socket.destroy();
    }
    const limit = this.AppOptions.bodyLimit;

    const clHeader = req.headers["content-length"];
    if (clHeader !== undefined) {
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

  public async close(...args: Parameters<http.Server["close"]>) {
    this.acceptIncomming = false;

    process.off("uncaughtException", this.handleUncaught);
    process.off("unhandledRejection", this.handleRejection);

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
