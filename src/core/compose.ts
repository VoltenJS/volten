import type { VoltenChainHandler, VoltenHandler } from "./types.ts";
import { RequestContext } from "../utils/requestCtx.ts";
import { InvalidNextCallError, VoltenError } from "./errors.ts";

/*
// Not used anymore. Only kept for reference
export function compose(middleware: VoltenHandler[]): VoltenHandler {
  return function (ctx, next) {
    let i = -1;
    function dispatch(index: number): void {
      if (index <= i) throw new Error("next() called multiple times");
      i = index;
      const fn = middleware[index];
      if (!fn) {
        if (next) next();
        return;
      }
      fn(ctx, () => dispatch(index + 1));
    }
    dispatch(0);
  };
}
*/

export function compileMiddlewareChain(chain: VoltenHandler[]): VoltenChainHandler {
  const len = chain.length;

  return function (ctx: RequestContext): Promise<void> {
    let index = -1;

    function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new InvalidNextCallError();
      }
      index = i;

      if (i >= len) return Promise.resolve();

      const fn = chain[i];
      if (fn == undefined) {
        return dispatch(i + 1);
      }

      try {
        // Return directly to preserve promise chains (whether sync or async)
        return Promise.resolve(
          fn(ctx, () => {
            if (ctx.sent) {
              throw new InvalidNextCallError();
            }
            return dispatch(i + 1);
          }),
        ).catch((err: unknown) => {
          process.nextTick(() => {
            if (!ctx.sent) {
              void ctx.app.handleError(err, ctx);
            }
          });
          return Promise.reject(VoltenError.from(err));
        });
      } catch (err: unknown) {
        process.nextTick(() => {
          if (!ctx.sent) {
            void ctx.app.handleError(err, ctx);
          }
        });
        return Promise.reject(VoltenError.from(err));
      }
    }

    return dispatch(0).catch((err: unknown) => {
      if (ctx._app !== null) {
        void ctx._app.handleError(err, ctx);
      }
    });
  };
}
