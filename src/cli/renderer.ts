import type { ReplayResult } from "../tools/drr/replay.ts";
import type { TraceEvent } from "../tools/drr/tracer.ts";

// Try to use ANSI builder if it exports one, otherwise fallback to plain ANSI codes
// Looking at logger.js, it exports ANSI directly or a builder.
// Actually, logger.js is a CommonJS/ESM mix or just standard script?
// Let's implement our own lightweight ANSI to be safe since logger.js might not be exported cleanly for TS.

const reset = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";

function formatMs(ms: number): string {
  return `${ms.toFixed(2)}ms`.padStart(8, " ");
}

export function renderForensicReport(result: ReplayResult) {
  const trace = result.trace;
  if (trace === undefined) {
    console.info(
      `${red}No forensic trace found. Ensure process.env.VOLTEN_DRR_REPLAY is set.${reset}`,
    );
    return;
  }

  console.info(`\n${bold}[DRR FORENSIC REPORT]${reset}`);
  console.info(`${dim}${"-".repeat(80)}${reset}`);

  console.info(`\n${bold}[TIMELINE & EXECUTION PATH]${reset}`);

  if (trace.timeline.length === 0) {
    console.info(`  ${dim}No middleware executed.${reset}`);
  }

  for (let i = 0; i < trace.timeline.length; i++) {
    const event = trace.timeline[i] as TraceEvent;
    const duration = formatMs(event.durationMs);
    const hasError = event.error !== undefined;

    // Determine type (Guard vs Handler vs Middleware) based on name heuristics or fallback
    let type = "Middleware";
    if (event.name.toLowerCase().includes("guard")) type = "Guard";
    else if (event.name.toLowerCase().includes("handler") || i === trace.timeline.length - 1)
      type = "Handler";

    const typeTag = `[${type}]`.padEnd(14, " ");
    const status = hasError ? `${red}(THREW ERROR)${reset}` : `${green}(Passed)${reset}`;

    const line = `  ${cyan}${duration}${reset} -> ${yellow}${typeTag}${reset} ${event.name} ${status}`;
    console.info(line);
  }

  console.info(`\n${bold}[STATE MUTATION TRACKING]${reset}`);

  let hasMutations = false;
  for (const event of trace.timeline) {
    for (const mut of event.mutations) {
      hasMutations = true;
      const fromStr = mut.from === undefined ? "undefined" : mut.from;
      const toStr = mut.to === undefined ? "undefined" : mut.to;
      console.info(`  ctx.state.${mut.key}: ${dim}${fromStr}${reset} -> ${green}${toStr}${reset}`);
    }
  }

  if (!hasMutations) {
    console.info(`  ${dim}No state mutations detected.${reset}`);
  }

  console.info(`\n${bold}[REPLAY RESULT]${reset}`);
  const statusCodeColor =
    result.statusCode >= 500 ? red : result.statusCode >= 400 ? yellow : green;
  console.info(`  Status: ${statusCodeColor}${String(result.statusCode)}${reset}`);

  if (trace.error !== undefined) {
    console.info(`  Error Caught: ${red}${trace.error.name}: ${trace.error.message}${reset}`);
  }

  console.info(`${dim}${"-".repeat(80)}${reset}\n`);
}
