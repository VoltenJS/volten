import type { AdaptiveTriageOptions } from "../core/types.ts";
import type { IntervalHistogram } from "node:perf_hooks";

export class AdaptiveEngine {
  public state: "NORMAL" | "WARNING" | "CRITICAL" = "NORMAL";
  private options: Required<AdaptiveTriageOptions>;
  private histogram: IntervalHistogram | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(options: AdaptiveTriageOptions) {
    this.options = {
      enabled: options.enabled ?? false,
      warningThresholdMs: options.warningThresholdMs ?? 40,
      criticalThresholdMs: options.criticalThresholdMs ?? 100,
      resolutionMs: options.resolutionMs ?? 10,
      checkIntervalMs: options.checkIntervalMs ?? 500,
    };

    if (this.options.enabled) {
      // Background initialization
      this.initSensor().catch(() => {});
    }
  }

  public get enabled(): boolean {
    return this.options.enabled;
  }

  private async initSensor(): Promise<void> {
    try {
      const perf_hooks = await import("node:perf_hooks");

      if (typeof perf_hooks.monitorEventLoopDelay === "function") {
        this.histogram = perf_hooks.monitorEventLoopDelay({
          resolution: this.options.resolutionMs,
        });
        this.histogram.enable();

        this.intervalTimer = setInterval(() => {
          this.tick();
        }, this.options.checkIntervalMs);

        this.intervalTimer.unref();
      }
    } catch {
      console.warn(
        "[Volten] Adaptive Triage is enabled but node:perf_hooks is not available in this environment. Running in fallback mode.",
      );
    }
  }

  private tick(): void {
    if (this.histogram === null) return;

    // Convert nanoseconds to milliseconds using max to catch single-spike lags
    const maxMs = this.histogram.max / 1e6;
    this.histogram.reset();

    if (maxMs > this.options.criticalThresholdMs) {
      this.state = "CRITICAL";
    } else if (maxMs > this.options.warningThresholdMs) {
      this.state = "WARNING";
    } else {
      this.state = "NORMAL";
    }
  }

  public evaluateState(): void {
    if (this.histogram !== null) {
      const currentMaxMs = this.histogram.max / 1e6;
      if (currentMaxMs > this.options.criticalThresholdMs) {
        this.state = "CRITICAL";
      } else if (currentMaxMs > this.options.warningThresholdMs) {
        this.state = "WARNING";
      }
    }
  }

  public shouldDrop(priority: "critical" | "normal" | "low" | undefined): boolean {
    if (!this.options.enabled) return false;

    this.evaluateState();

    if (this.state === "NORMAL") return false;

    const p = priority ?? "normal";
    if (this.state === "WARNING" && p === "low") return true;
    if (this.state === "CRITICAL" && p !== "critical") return true;

    return false;
  }

  public close(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.histogram !== null) {
      this.histogram.disable();
    }
  }
}
