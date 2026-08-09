import type { FingerPrintData, SerializerFn } from "../core/types.ts";

const OBJ_STACK: unknown[] = new Array(32);

export class JitCache {
  private cache = new Map<number, FingerPrintData>();
  private maxCapacity: number;

  constructor(maxCapacity = 2000) {
    this.maxCapacity = maxCapacity;
  }

  private fingerprintMap = new WeakMap<object, number>();

  private touch(fingerprint: number, data: FingerPrintData): void {
    this.cache.delete(fingerprint);
    this.cache.set(fingerprint, data);
  }

  /**
   * Generates a fast, lightweight structural shape fingerprint
   * based on object keys and value types using a non-recursive stack traversal.
   */
  public getShapeFingerprint(obj: unknown): number {
    if (obj !== null && typeof obj === "object") {
      const cached = this.fingerprintMap.get(obj);
      if (cached !== undefined) return cached;
    }

    let hash = 2166136261;
    let sp = 0;
    OBJ_STACK[sp++] = obj;

    while (sp > 0) {
      const val = OBJ_STACK[--sp];

      if (val === null) {
        hash = Math.imul(hash ^ 1, 16777619);
        continue;
      }

      const type = typeof val;
      switch (type) {
        case "object":
          if (Array.isArray(val)) {
            hash = Math.imul(hash ^ 6, 16777619);
          } else if (val instanceof Date) {
            hash = Math.imul(hash ^ 9, 16777619);
          } else {
            hash = Math.imul(hash ^ 7, 16777619);
            let count = 0;
            const valObj = val as Record<string, unknown>;
            for (const key in valObj) {
              if (Object.prototype.hasOwnProperty.call(valObj, key)) {
                hash = Math.imul(hash ^ key.length, 16777619);
                hash = Math.imul(hash ^ key.charCodeAt(0), 16777619);
                if (sp < 32) OBJ_STACK[sp++] = valObj[key];
                if (++count > 14) break;
              }
            }
          }
          break;
        case "number":
          hash = Math.imul(hash ^ 3, 16777619);
          break;
        case "string":
          hash = Math.imul(hash ^ 4, 16777619);
          break;
        case "boolean":
          hash = Math.imul(hash ^ 5, 16777619);
          break;
        case "undefined":
          hash = Math.imul(hash ^ 2, 16777619);
          break;
        case "function":
          hash = Math.imul(hash ^ 8, 16777619);
          break;
        case "bigint":
          hash = Math.imul(hash ^ 11, 16777619);
          break;
        case "symbol":
          hash = Math.imul(hash ^ 12, 16777619);
          break;
        default:
          hash = Math.imul(hash ^ 10, 16777619);
      }
    }
    const result = hash >>> 0;
    const finalResult = result === 0 ? 1 : result;
    if (obj !== null && typeof obj === "object") {
      this.fingerprintMap.set(obj, finalResult);
    }
    return finalResult;
  }

  public get(fingerprint: number): SerializerFn | undefined {
    const data = this.cache.get(fingerprint);
    if (data !== undefined) {
      this.touch(fingerprint, data);
      return data.JITcompiler ?? undefined;
    }
    return undefined;
  }

  public set(fingerprint: number, fn: SerializerFn): void {
    let data = this.cache.get(fingerprint);
    if (data === undefined) {
      this.create(fingerprint);
      data = this.cache.get(fingerprint);
    } else {
      this.touch(fingerprint, data);
    }
    if (data !== undefined) {
      data.JITcompiler = fn;
    }
  }

  public create(fingerprint: number) {
    if (this.cache.size >= this.maxCapacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    const fingerprintData: FingerPrintData = {
      stableCount: 0,
      JITcompiler: null,
    };
    this.cache.set(fingerprint, fingerprintData);
  }

  public getCompiler(fingerprint: number): SerializerFn | null {
    return this.get(fingerprint) ?? null;
  }

  public getCount(fingerprint: number): number {
    const data = this.cache.get(fingerprint);
    if (data === undefined) {
      throw new Error("Fingerprint does not exist");
    }
    return data.stableCount;
  }

  public setCompiler(fingerprint: number, fn: SerializerFn) {
    const data = this.cache.get(fingerprint);
    if (data === undefined) {
      throw new Error("Attempting to set a compiler for a fingerprint that doesn't exist");
    }
    data.JITcompiler = fn;
    this.touch(fingerprint, data);
  }

  public addCount(fingerprint: number) {
    const data = this.cache.get(fingerprint);
    if (data === undefined) {
      throw new Error("Attempting to add count for a fingerprint that doesn't exist");
    }
    data.stableCount += 1;
  }

  public resetCount(fingerprint: number) {
    const data = this.cache.get(fingerprint);
    if (data === undefined) {
      throw new Error("Attempting to reset count for a fingerprint that doesn't exist");
    }
    data.stableCount = 0;
  }

  public delete(fingerprint: number) {
    const data = this.cache.get(fingerprint);
    if (data === undefined) {
      throw new Error("Attempting to delete a fingerprint that doesn't exist");
    }
    data.JITcompiler = null;
    data.stableCount = 0;
  }
}
