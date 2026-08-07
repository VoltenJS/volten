import { JitCache } from "./jitCache.ts";
import type { SerializerFn } from "../core/types.ts";
const globalVoltCache = new JitCache(2000);

export const createCompiledStringifier = compileVoltJson;
export function getShapeFingerprint(obj: unknown): number {
  return globalVoltCache.getShapeFingerprint(obj);
}

export function compileVoltJson(sample: unknown): SerializerFn {
  const helperFns: string[] = [];

  function buildTemplateString(obj: unknown, path: string): string {
    if (obj === null || obj === undefined) return "null";
    const type = typeof obj;

    if (type === "string") return `"\${${path}}"`;

    if (type === "number" || type === "boolean" || type === "bigint") return `\${${path}}`;

    if (obj instanceof Date) return `"\${${path}.toISOString()}"`;

    if (Array.isArray(obj)) {
      return `\${${path} ? JSON.stringify(${path}) : "[]"}`;
    }

    if (type === "object") {
      const keys = Object.keys(obj);
      const validKeys: string[] = [];

      for (const key of keys) {
        const val = (obj as Record<string, unknown>)[key];
        if (val === undefined || typeof val === "function" || typeof val === "symbol") continue;

        const isIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
        const childPath = isIdentifier ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

        const expr = buildTemplateString(val, childPath);
        // Ensure keys have proper quotes but escape correctly inside the backtick literal
        validKeys.push(`${JSON.stringify(key)}:${expr}`);
      }

      if (validKeys.length === 0) return "{}";
      return `{${validKeys.join(",")}}`;
    }

    return `\${JSON.stringify(${path})}`;
  }

  const templateStr = buildTemplateString(sample, "d");

  const fnBody = `
${helperFns.join("\n")}
if (!d) return "null";
return \`${templateStr}\`;
`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("d", fnBody) as SerializerFn;
  } catch (err) {
    console.error("JIT Error:", err);
    return (d: unknown) => JSON.stringify(d);
  }
}

export function isSimple(data: unknown): boolean {
  if (data === null || typeof data !== "object") return true;
  if (Array.isArray(data)) {
    return data.length < 8;
  }
  let count = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      if (++count > 6) return false;
      const val = (data as Record<string, unknown>)[key];
      if (val !== null && typeof val === "object") return false;
    }
  }
  return true;
}

const serializerWeakMap = new WeakMap<object, SerializerFn>();

/**
 * Predictive Entry Point Function
 * Uses shape fingerprint caching for sub-microsecond setup times.
 */
export function voltJson(data: unknown): string {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!data) return JSON.stringify(data);

  let compiledSerializer: SerializerFn | undefined;

  if (typeof data === "object") {
    compiledSerializer = serializerWeakMap.get(data);
  }

  if (compiledSerializer === undefined) {
    const fingerprint = globalVoltCache.getShapeFingerprint(data);
    compiledSerializer = globalVoltCache.get(fingerprint);
    if (compiledSerializer === undefined) {
      compiledSerializer = createCompiledStringifier(data);
      globalVoltCache.set(fingerprint, compiledSerializer);
    }

    if (typeof data === "object") {
      serializerWeakMap.set(data, compiledSerializer);
    }
  }

  return compiledSerializer(data);
}
