import { RequestContext } from "../../utils/requestCtx.ts";

export interface StateMutation {
  key: string;
  from: string | undefined;
  to: string | undefined;
}

export interface TraceEvent {
  name: string;
  durationMs: number;
  mutations: StateMutation[];
  error?: Error;
}

export interface ReplayTraceContext {
  timeline: TraceEvent[];
  error?: Error;
}

export function formatValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "function") {
    const fnName = (value as { name?: string }).name;
    return `[Function: ${fnName !== undefined && fnName !== "" ? fnName : "anonymous"}]`;
  }
  if (typeof value === "object") {
    if (
      "constructor" in value &&
      typeof value.constructor === "function" &&
      value.constructor.name !== "Object"
    ) {
      return `[${value.constructor.name}]`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "[Circular]";
    }
  }
  return Object.prototype.toString.call(value);
}

export function diffState(
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>,
): StateMutation[] {
  const mutations: StateMutation[] = [];
  const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

  for (const key of keys) {
    if (key === "__volten_drr_replay" || key === "__volten_drr_trace") continue;
    if (oldState[key] !== newState[key]) {
      mutations.push({
        key,
        from: formatValue(oldState[key]),
        to: formatValue(newState[key]),
      });
    }
  }

  return mutations;
}

export function traceMiddleware(
  ctx: RequestContext,
  middlewareName: string,
  handler: () => unknown,
): unknown {
  const traceCtx: ReplayTraceContext = (
    ctx.state["__volten_drr_trace"] !== undefined
      ? ctx.state["__volten_drr_trace"]
      : { timeline: [] }
  ) as ReplayTraceContext;
  ctx.state["__volten_drr_trace"] = traceCtx;

  const name = middlewareName !== "" ? middlewareName : "anonymous-middleware";
  const startState = { ...ctx.state };
  const startTime = performance.now();

  const recordSuccess = () => {
    const durationMs = performance.now() - startTime;
    traceCtx.timeline.push({
      name,
      durationMs,
      mutations: diffState(startState, ctx.state),
    });
  };

  const recordError = (err: unknown) => {
    const durationMs = performance.now() - startTime;
    const error = err instanceof Error ? err : new Error(String(err));
    traceCtx.timeline.push({
      name,
      durationMs,
      mutations: diffState(startState, ctx.state),
      error,
    });
    if (traceCtx.error === undefined) {
      traceCtx.error = error;
    }
  };

  try {
    const res = handler();
    if (res !== null && typeof res === "object" && "then" in res) {
      const thenable = res as {
        then: (
          onfulfilled?: (val: unknown) => unknown,
          onrejected?: (err: unknown) => unknown,
        ) => Promise<unknown>;
      };
      if (typeof thenable.then === "function") {
        return thenable.then(
          (val: unknown) => {
            recordSuccess();
            return val;
          },
          (err: unknown) => {
            recordError(err);
            throw err;
          },
        );
      }
    }
    recordSuccess();
    return res;
  } catch (err) {
    recordError(err);
    throw err;
  }
}
