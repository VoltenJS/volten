import { VoltenHandler } from "./types.ts";
import { RequestContext } from "../utils/requestctx.ts";

// Not used anymore. Only kept for reference
export function compose(middleware: VoltenHandler[]): VoltenHandler {
  return function (ctx, next) {
    let i = -1;
    function dispatch(index: number): any {
      if (index <= i) throw new Error("next() called multiple times");
      i = index;
      const fn = middleware[index];
      if (!fn) return next ? next() : undefined;
      return fn(ctx, () => dispatch(index + 1));
    }
    return dispatch(0);
  };
}

export function compileMiddlewareChain(
  middleware: VoltenHandler[],
  finalHandler: VoltenHandler,
): VoltenHandler {
  const chain = [...middleware, finalHandler];
  const len = chain.length;

  return function (ctx: RequestContext) {
    let index = -1;

    function dispatch(i: number): any {
      if (i <= index)
        return Promise.reject(new Error("next() called multiple times"));
      index = i;

      if (i >= len) return Promise.resolve();

      const fn = chain[i];
      try {
        const result = fn(ctx, () => {
          if (ctx.sent) {
            return Promise.reject(
              new Error("Detected next() call after response sent"),
            );
          }
          return dispatch(i + 1);
        });

        if (result && typeof result.then === "function") {
          return result;
        }
        return Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return dispatch(0).catch((err: any) => {
      if (ctx._app) {
        ctx._app.handleError(err, ctx.res, ctx);
      }
    });
  };
}
