import type { AdaptiveTriageOptions } from "../core/types.ts";

interface EventLoopDelayMonitor {
  enable(): boolean;
  disable(): boolean;
  reset(): void;
  percentile(percentile: number): number;
}

interface PerfHooks {
  monitorEventLoopDelay?: (options?: { resolution?: number }) => EventLoopDelayMonitor;
}

export class AdaptiveEngine {
  public state: "NORMAL" | "WARNING" | "CRITICAL" = "NORMAL";
  private options: Required<AdaptiveTriageOptions>;
  private histogram: EventLoopDelayMonitor | null = null;
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
      this.initSensor();
    }
  }

  private initSensor(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const perf_hooks = (require("perf_hooks") as unknown) as PerfHooks;
      
      if (typeof perf_hooks.monitorEventLoopDelay === "function") {
        this.histogram = perf_hooks.monitorEventLoopDelay({ resolution: this.options.resolutionMs });
        this.histogram.enable();

        this.intervalTimer = setInterval(() => {
          this.tick();
        }, this.options.checkIntervalMs);

        // Don't keep the event loop alive just for this interval
        this.intervalTimer.unref();
      }
    } catch {
      // Edge runtime or perf_hooks unavailable
      // In Edge (like Workers), CPU time is limited per request, so event loop delay isn't a direct analog.
      // We gracefully fallback to NORMAL state permanently if perf_hooks isn't available.
      console.warn("[Volten] Adaptive Triage is enabled but perf_hooks is not available in this environment. Running in fallback mode.");
    }
  }

  private tick(): void {
    if (this.histogram === null) return;

    // Convert nanoseconds to milliseconds
    const p99 = this.histogram.percentile(99) / 1e6;
    this.histogram.reset();

    if (p99 > this.options.criticalThresholdMs) {
      this.state = "CRITICAL";
    } else if (p99 > this.options.warningThresholdMs) {
      this.state = "WARNING";
    } else {
      this.state = "NORMAL";
    }
  }

  public shouldDrop(priority: "critical" | "normal" | "low" | undefined): boolean {
    if (!this.options.enabled || this.state === "NORMAL") return false;
    
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
