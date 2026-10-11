import type { VoltenChainHandler, VoltenHandler } from "./types.ts";
import { InvalidNextCallError, VoltenError } from "./errors.ts";
import http from "node:http";

import type { RequestContext, EdgeRequestContext } from "../utils/requestCtx.ts";

function isPromiseLike(val: unknown): val is PromiseLike<unknown> {
  return val !== null && typeof val === "object" && "then" in val && typeof val.then === "function";
}

const noop = (): void => {};

/** Resolves when the response drains, closes or errors (whichever comes first); never leaks listeners. */
function waitForDrain(res: http.ServerResponse): Promise<void> {
  if (typeof res.once !== "function") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      if (typeof res.off === "function") {
        res.off("drain", done);
        res.off("close", done);
        res.off("error", done);
      }
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
    res.once("error", done);
  });
}

/**
 * Pipes a Web Response body into the Node response with real backpressure: the next chunk is only
 * pulled from the Web stream once the socket accepted the previous one. If the Node response
 * closes, the Web stream is cancelled so the producer stops.
 */
async function writeWebResponseToNode(webRes: Response, ctx: RequestContext): Promise<void> {
  const resObj = ctx.res;
  if (resObj === null) {
    if (webRes.body !== null) await webRes.body.cancel().catch(noop);
    return;
  }
  ctx.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    ctx.setHeader(key, val);
  });
  if (webRes.body === null) {
    resObj.end();
    return;
  }
  const reader = webRes.body.getReader();
  let aborted = resObj.destroyed;
  const nodeReq = ctx._req instanceof http.IncomingMessage ? ctx._req : null;
  const onClose = (): void => {
    aborted = true;
    reader.cancel().catch(noop);
  };
  if (typeof resObj.once === "function") {
    resObj.once("close", onClose);
  }
  if (nodeReq !== null && typeof nodeReq.once === "function") {
    nodeReq.once("close", onClose);
  }
  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (resObj.destroyed) break;
      const accepted = resObj.write(value);
      if (!accepted) {
        await waitForDrain(resObj);
      }
    }
    if (aborted || resObj.destroyed) {
      await reader.cancel().catch(noop);
    } else {
      resObj.end();
    }
  } catch (err) {
    await reader.cancel(err).catch(noop);
    throw err;
  } finally {
    resObj.off("close", onClose);
    if (nodeReq !== null && typeof nodeReq.off === "function") {
      nodeReq.off("close", onClose);
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export function handleHandlerResult(res: unknown, ctx: RequestContext): unknown {
  if (res === undefined) return;
  if (
    res !== null &&
    typeof res === "object" &&
    typeof (res as Promise<unknown>).then === "function"
  ) {
    const thenable = res as { then: (cb: (val: unknown) => unknown) => Promise<unknown> };
    return thenable.then((val: unknown) => {
      if (val !== undefined && !ctx.sent) {
        if (typeof Response !== "undefined" && val instanceof Response) {
          if (ctx.runtime === "edge") {
            const edgeCtx = ctx as unknown as EdgeRequestContext;
            edgeCtx._edgeBodySent = true;
            edgeCtx._resolveEdgeResponse(val);
          } else {
            return writeWebResponseToNode(val, ctx);
          }
        } else {
          ctx.send(val);
        }
      }
      return val;
    });
  }
  if (!ctx.sent) {
    if (typeof Response !== "undefined" && res instanceof Response) {
      if (ctx.runtime === "edge") {
        const edgeCtx = ctx as unknown as EdgeRequestContext;
        edgeCtx._edgeBodySent = true;
        edgeCtx._resolveEdgeResponse(res);
      } else {
        return writeWebResponseToNode(res, ctx);
      }
    } else {
      ctx.send(res);
    }
  }
  return res;
}

export function createDynamicMiddlewareChain(chain: VoltenHandler[]): VoltenChainHandler {
  const len = chain.length;
  if (len === 0) {
    return function (): Promise<void> {
      return Promise.resolve();
    };
  }

  return function (ctx: RequestContext): Promise<void> {
    let index = -1;
    // Every downstream promise is tracked so the chain only settles when ALL of them settled,
    // even if a middleware called next() without awaiting it. This is what lets the server keep
    // the pooled context alive until no framework-started work can still touch it.
    const tracked: Promise<void>[] = [];

    const dispatch = (i: number): Promise<void> => {
      if (i <= index) throw new InvalidNextCallError();
      index = i;
      if (i === len) return Promise.resolve();
      if (ctx.sent) throw new InvalidNextCallError();

      let res: unknown;
      try {
        const fn = chain[i];
        if (fn !== undefined) {
          res = handleHandlerResult(
            fn(ctx, () => dispatch(i + 1)),
            ctx,
          );
        }
      } catch (err) {
        res = Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }

      if (isPromiseLike(res)) {
        const p = Promise.resolve(res);
        let isAwaited = false;

        const appRef = ctx._app;
        // Observes the rejection (no unhandledRejection). If nobody awaited the promise, the
        // framework reports the error itself; this happens inside the tracked promise so the
        // chain does not settle (and the context is not recycled) before it ran.
        tracked.push(
          p.then(
            noop,
            (err: unknown) =>
              new Promise<void>((resolve) => {
                setImmediate(() => {
                  if (!isAwaited && appRef !== null) {
                    Promise.resolve(appRef.handleError(VoltenError.from(err), ctx)).then(
                      resolve,
                      resolve,
                    );
                  } else {
                    resolve();
                  }
                });
              }),
          ),
        );

        const wrapper = Object.create(p) as Promise<void>;
        void Object.defineProperty(wrapper, "then", {
          value: (...args: unknown[]) => {
            isAwaited = true;
            return (p.then as (...a: unknown[]) => unknown)(...args);
          },
          writable: true,
          configurable: true,
        });
        void Object.defineProperty(wrapper, "catch", {
          value: (...args: unknown[]) => {
            isAwaited = true;
            return (p.catch as (...a: unknown[]) => unknown)(...args);
          },
          writable: true,
          configurable: true,
        });
        void Object.defineProperty(wrapper, "finally", {
          value: (...args: unknown[]) => {
            isAwaited = true;
            return (p.finally as (...a: unknown[]) => unknown)(...args);
          },
          writable: true,
          configurable: true,
        });
        return wrapper;
      }
      return Promise.resolve();
    };

    const drainTracked = async (): Promise<void> => {
      let seen = 0;
      while (seen < tracked.length) {
        const batch = tracked.slice(seen);
        seen = tracked.length;
        await Promise.all(batch);
      }
    };

    const reportError = (err: unknown): Promise<void> | void => {
      if (ctx._app !== null) {
        return ctx._app.handleError(VoltenError.from(err), ctx);
      }
      return undefined;
    };

    try {
      return dispatch(0)
        .catch((err: unknown) => reportError(err))
        .then(drainTracked);
    } catch (err) {
      return Promise.resolve(reportError(err)).then(drainTracked);
    }
  };
}

export function compileMiddlewareChain(chain: VoltenHandler[]): VoltenChainHandler {
  return createDynamicMiddlewareChain(chain);
}
