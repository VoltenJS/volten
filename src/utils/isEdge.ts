let isEdgeOverride: boolean | null = null;
let evalBlocked: boolean | null = null;

/**
 * Manually override the Edge environment detection flag.
 * Useful for tests and custom environment configurations.
 */
export function setIsEdge(val: boolean | null): void {
  isEdgeOverride = val;
}

/**
 * Checks if code generation from strings (Function/eval) is blocked in this runtime.
 */
function checkEvalBlocked(): boolean {
  if (evalBlocked !== null) {
    return evalBlocked;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("");
    evalBlocked = false;
  } catch {
    evalBlocked = true;
  }
  return evalBlocked;
}

/**
 * Determines whether the current execution environment is an Edge runtime
 * (such as Cloudflare Workers, Vercel Edge Runtime, or WinterCG workers)
 * or has dynamic Function/eval execution blocked.
 */
export function isEdge(): boolean {
  if (isEdgeOverride !== null) {
    return isEdgeOverride;
  }

  // 1. Vercel Edge Runtime
  if (typeof (globalThis as Record<string, unknown>)["EdgeRuntime"] === "string") {
    return true;
  }

  // 2. Cloudflare Workers navigator userAgent
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.includes("Cloudflare-Workers")
  ) {
    return true;
  }

  // 3. Cloudflare Workers WebSocketPair
  if (typeof (globalThis as Record<string, unknown>)["WebSocketPair"] !== "undefined") {
    return true;
  }

  // 4. Environment variable detection
  if (typeof process !== "undefined") {
    const nextRuntime = process.env["NEXT_RUNTIME"];
    const edgeRuntime = process.env["EDGE_RUNTIME"];
    const voltenRuntime = process.env["VOLTEN_RUNTIME"];
    const nodeEnv = process.env["NODE_ENV"];
    if (
      nextRuntime === "edge" ||
      edgeRuntime === "true" ||
      edgeRuntime === "1" ||
      voltenRuntime === "edge" ||
      nodeEnv === "edge"
    ) {
      return true;
    }
  }

  // 5. Environment where process is not defined (standard in browser/edge environments)
  if (typeof process === "undefined") {
    return true;
  }

  // 6. Check if dynamic eval/Function is blocked
  if (checkEvalBlocked()) {
    return true;
  }

  return false;
}
