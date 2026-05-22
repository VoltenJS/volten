import { FingerPrintData, JitCompilerFunction } from "../core/types.ts";
// To-Do: make an addData & getData function
export class JitCache {
  private cache = new Map<number, FingerPrintData>();
  private readonly max: number;

  constructor(maxSize = 1000) {
    this.max = maxSize;
  }

  create(fingerprint: number) {
    if (this.cache.size >= this.max) {
      // Evict the oldest item (the first key in the Map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    const fingerprintData: FingerPrintData = {
      stableCount: 0,
      JITcompiler: null,
    };
    this.cache.set(fingerprint, fingerprintData);
  }

  getCompiler(fingerprint: number) {
    const fingerprintData = this.cache.get(fingerprint);
    let fn = null;
    if (fingerprintData) {
      const { JITcompiler } = fingerprintData;
      if (JITcompiler) {
        fn = JITcompiler;
        this.cache.delete(fingerprint);
        this.cache.set(fingerprint, fingerprintData);
      }
    }
    return fn;
  }

  getCount(fingerprint: number) {
    const fingerprintData = this.cache.get(fingerprint);
    let count;
    if (fingerprintData) {
      const { stableCount } = fingerprintData;
      count = stableCount;
    } else {
      throw new Error("Fingerprint does not exist");
    }
    return count;
  }

  setCompiler(fingerprint: number, fn: JitCompilerFunction) {
    const existingFingerprint: FingerPrintData | null =
      this.cache.get(fingerprint) || null;

    if (!existingFingerprint) {
      throw new Error(
        "Attempting to set a compiler for a fingerprint that doesn't exist in the cache",
      );
    }
    existingFingerprint.JITcompiler = fn;
    this.cache.set(fingerprint, existingFingerprint);
  }

  addCount(fingerprint: number) {
    const existingFingerprint: FingerPrintData | null =
      this.cache.get(fingerprint) || null;

    if (!existingFingerprint) {
      throw new Error(
        "Attempting to add count for a fingerprint that doesn't exist in the cache",
      );
    }
    existingFingerprint.stableCount += 1;
    this.cache.set(fingerprint, existingFingerprint);
  }
  resetCount(fingerprint: number) {
    const existingFingerprint: FingerPrintData | null =
      this.cache.get(fingerprint) || null;

    if (!existingFingerprint) {
      throw new Error(
        "Attempting to reset count for a fingerprint that doesn't exist in the cache",
      );
    }
    existingFingerprint.stableCount = 0;
    this.cache.set(fingerprint, existingFingerprint);
  }

  delete(fingerprint: number) {
    const existingFingerprint: FingerPrintData | null =
      this.cache.get(fingerprint) || null;

    if (!existingFingerprint) {
      throw new Error(
        "Attempting to delete a fingerprint that doesn't exist in the cache",
      );
    }
    existingFingerprint.JITcompiler = null;
    existingFingerprint.stableCount = 0;
    this.cache.set(fingerprint, existingFingerprint);
  }
}
