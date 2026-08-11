import type { VoltenChainHandler, VoltenHandler } from "./types.ts";
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
  if (len === 0) {
    return function (): Promise<void> {
      return Promise.resolve();
    };
  }

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
    lines.push(`    return chain[${String(i)}](ctx, next_${String(i + 1)});`);
    lines.push(`  };`);
  }

  lines.push("  try {");
  lines.push("    index = 0;");
  lines.push("    const res = chain[0](ctx, next_1);");
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
  const factory = new Function("chain", "InvalidNextCallError", "VoltenError", lines.join("\n"));
  /* eslint-disable @typescript-eslint/no-unsafe-call */
  return factory(chain, InvalidNextCallError, VoltenError) as VoltenChainHandler;
}
