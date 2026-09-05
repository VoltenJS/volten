import type { VoltenChainHandler, VoltenHandler } from "./types.ts";
import { InvalidNextCallError, VoltenError } from "./errors.ts";

import type { RequestContext, EdgeRequestContext } from "../utils/requestCtx.ts";
import { isEdge } from "../utils/isEdge.ts";

async function writeWebResponseToNode(webRes: Response, ctx: RequestContext) {
  ctx.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    ctx.setHeader(key, val);
  });
  if (webRes.body !== null) {
    const reader = webRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const resObj = ctx.res;
        if (resObj !== null) {
          resObj.write(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  const resObj = ctx.res;
  if (resObj !== null) {
    resObj.end();
  }
}

export function handleHandlerResult(res: unknown, ctx: RequestContext): unknown {
  if (res === undefined) return;
  if (res !== null && typeof res === "object" && "then" in res) {
    const thenable = res as { then: (cb: (val: unknown) => unknown) => Promise<unknown> };
    if (typeof thenable.then === "function") {
      return thenable.then((val: unknown) => {
        if (val !== undefined && !ctx.sent) {
          if (typeof Response !== "undefined" && val instanceof Response) {
            if (ctx.runtime === "edge") {
              const edgeCtx = ctx as EdgeRequestContext;
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
  }
  if (!ctx.sent) {
    if (typeof Response !== "undefined" && res instanceof Response) {
      if (ctx.runtime === "edge") {
        const edgeCtx = ctx as EdgeRequestContext;
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

    const dispatch = (i: number): Promise<void> | void => {
      if (i <= index) {
        throw new InvalidNextCallError();
      }
      index = i;
      if (i === len) {
        return Promise.resolve();
      }
      if (ctx.sent) {
        throw new InvalidNextCallError();
      }
      return handleHandlerResult(
        chain[i](ctx, () => dispatch(i + 1)),
        ctx,
      ) as Promise<void> | void;
    };

    try {
      index = 0;
      const res = handleHandlerResult(
        chain[0](ctx, () => dispatch(1)),
        ctx,
      );
      if (res !== null && typeof res === "object" && "then" in res) {
        const thenable = res as { catch: (cb: (err: unknown) => unknown) => Promise<unknown> };
        if (typeof thenable.catch === "function") {
          return thenable.catch(function (err: unknown) {
            if (ctx._app !== null) {
              void ctx._app.handleError(VoltenError.from(err), ctx);
            }
          }) as Promise<void>;
        }
      }
      return Promise.resolve();
    } catch (err) {
      if (ctx._app !== null) {
        void ctx._app.handleError(VoltenError.from(err), ctx);
      }
      return Promise.resolve();
    }
  };
}

export function compileMiddlewareChain(chain: VoltenHandler[]): VoltenChainHandler {
  const len = chain.length;
  if (len === 0) {
    return function (): Promise<void> {
      return Promise.resolve();
    };
  }

  if (isEdge()) {
    return createDynamicMiddlewareChain(chain);
  }

  try {
    const lines: string[] = [];
    lines.push("return function(ctx) {");
    lines.push("  let index = -1;");

    lines.push(`  const next_${String(len)} = () => {`);
    lines.push(`    if (${String(len)} <= index) {`);
    lines.push(`      throw new InvalidNextCallError();`);
    lines.push(`    }`);
    lines.push(`    index = ${String(len)};`);
    lines.push(`    return Promise.resolve();`);
    lines.push(`  };`);

    for (let i = len - 1; i >= 1; i--) {
      lines.push(`  const next_${String(i)} = () => {`);
      lines.push(`    if (${String(i)} <= index) {`);
      lines.push(`      throw new InvalidNextCallError();`);
      lines.push(`    }`);
      lines.push(`    index = ${String(i)};`);
      lines.push(`    if (ctx.sent) {`);
      lines.push(`      throw new InvalidNextCallError();`);
      lines.push(`    }`);
      lines.push(
        `    return handleHandlerResult(chain[${String(i)}](ctx, next_${String(i + 1)}), ctx);`,
      );
      lines.push(`  };`);
    }

    lines.push("  try {");
    lines.push("    index = 0;");
    lines.push("    const res = handleHandlerResult(chain[0](ctx, next_1), ctx);");
    lines.push('    if (res && typeof res.then === "function") {');
    lines.push("      return res.catch(function(err) {");
    lines.push("        if (ctx._app !== null) {");
    lines.push("          void ctx._app.handleError(VoltenError.from(err), ctx);");
    lines.push("        }");
    lines.push("      });");
    lines.push("    }");
    lines.push("    return Promise.resolve();");
    lines.push("  } catch (err) {");
    lines.push("    if (ctx._app !== null) {");
    lines.push("      void ctx._app.handleError(VoltenError.from(err), ctx);");
    lines.push("    }");
    lines.push("    return Promise.resolve();");
    lines.push("  }");
    lines.push("};");

    /* eslint-disable-next-line @typescript-eslint/no-implied-eval */
    const factory = new Function(
      "chain",
      "InvalidNextCallError",
      "VoltenError",
      "handleHandlerResult",
      lines.join("\n"),
    );
    /* eslint-disable @typescript-eslint/no-unsafe-call */
    return factory(
      chain,
      InvalidNextCallError,
      VoltenError,
      handleHandlerResult,
    ) as VoltenChainHandler;
  } catch {
    return createDynamicMiddlewareChain(chain);
  }
}
