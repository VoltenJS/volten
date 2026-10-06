/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import type { RequestContext } from "../utils/requestCtx.ts";
import type { VoltenHandler, VoltenChainHandler, Next } from "./types.ts";
import { InvalidNextCallError, VoltenError } from "./errors.ts";
import { handleHandlerResult } from "./compose.ts";

export type ExecutionLevel = "GENERIC" | "OPTIMIZED" | "SPECIALIZED";

export interface RouteExecutionPlan {
  readonly id: number;
  readonly method: string;
  readonly path: string;
  level: ExecutionLevel;
  readonly paramCount: number;
  readonly effectiveHandlerCount: number;
  readonly terminalHandler: VoltenHandler;
  readonly chain: readonly VoltenHandler[];
  readonly executeNode: VoltenChainHandler;
  readonly executeEdge: VoltenChainHandler;
  readonly fallbackChain: VoltenChainHandler;
}

let planIdCounter = 0;

/**
 * Creates a direct single-handler executor for routes where the effective
 * middleware chain contains exactly one terminal handler.
 *
 * Preserves exact error handling, return value handling, and InvalidNextCallError
 * semantics of compileMiddlewareChain without unnecessary composition overhead.
 */
export function createSingleHandlerExecutor(handler: VoltenHandler): VoltenChainHandler {
  return function singleHandlerExecutor(ctx: RequestContext): Promise<unknown> | unknown {
    let index = -1;
    const next: Next = () => {
      if (1 <= index) {
        throw new InvalidNextCallError();
      }
      index = 1;
      return Promise.resolve();
    };

    try {
      index = 0;
      const res = handleHandlerResult(handler(ctx, next), ctx);
      if (
        res !== null &&
        typeof res === "object" &&
        typeof (res as { then?: unknown }).then === "function"
      ) {
        return (res as Promise<unknown>).catch(function (err: unknown) {
          if (ctx._app !== null) {
            void ctx._app.handleError(VoltenError.from(err), ctx);
          }
        });
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

/**
 * Constructs a minimal RouteExecutionPlan for an effective route handler chain.
 */
export function createExecutionPlan(
  method: string,
  path: string,
  chain: VoltenHandler[],
  composeChain: VoltenChainHandler,
  paramCount: number = 0,
): RouteExecutionPlan {
  const planId = ++planIdCounter;
  const effectiveHandlerCount = chain.length;
  const terminalHandler =
    chain[effectiveHandlerCount - 1] ??
    function (): Promise<void> {
      return Promise.resolve();
    };

  // Optimization candidate: exactly 1 effective handler
  if (effectiveHandlerCount === 1) {
    const singleExecutor = createSingleHandlerExecutor(terminalHandler);
    return {
      id: planId,
      method,
      path,
      level: "OPTIMIZED",
      paramCount,
      effectiveHandlerCount,
      terminalHandler,
      chain,
      executeNode: singleExecutor,
      executeEdge: singleExecutor,
      fallbackChain: composeChain,
    };
  }

  // Fallback: multiple handlers use standard composeChain
  return {
    id: planId,
    method,
    path,
    level: "GENERIC",
    paramCount,
    effectiveHandlerCount,
    terminalHandler,
    chain,
    executeNode: composeChain,
    executeEdge: composeChain,
    fallbackChain: composeChain,
  };
}
