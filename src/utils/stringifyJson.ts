import { JitCache } from "./jitCache.ts";
import type { SerializerFn } from "../core/types.ts";

const globalVoltCache = new JitCache(2000);

export const createCompiledStringifier = compileVoltJson;
export function getShapeFingerprint(obj: unknown): number {
  return globalVoltCache.getShapeFingerprint(obj);
}

export function compileVoltJson(_sample: unknown): SerializerFn {
  return (d: unknown) => JSON.stringify(d);
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

export function voltJson(data: unknown): string {
  return JSON.stringify(data);
}
