import { test, describe, mock, afterEach } from "node:test";
import assert from "node:assert";
import { AdaptiveEngine } from "../../../src/utils/adaptiveEngine.ts";

describe("AdaptiveEngine", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test("should initialize with default options (testing undefined branches)", () => {
    const engine = new AdaptiveEngine({});
    assert.strictEqual(engine.state, "NORMAL");
    assert.strictEqual(engine.shouldDrop("normal"), false);
    engine.close();
  });

  test("should initialize with explicit options (testing defined branches)", () => {
    const engine = new AdaptiveEngine({
      enabled: false,
      warningThresholdMs: 50,
      criticalThresholdMs: 200,
      resolutionMs: 5,
      checkIntervalMs: 100,
    });
    assert.strictEqual(engine.state, "NORMAL");
    engine.close();
  });

  test("should start sensor and trigger interval tick", async () => {
    let ticked = false;

    // Override tick to verify the interval callback executes it
    const originalTick = AdaptiveEngine.prototype["tick"];
    AdaptiveEngine.prototype["tick"] = function () {
      ticked = true;
      originalTick.call(this);
    };

    const engine = new AdaptiveEngine({ enabled: true, checkIntervalMs: 30 });

    // Wait for real interval to fire
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(ticked, true);
    AdaptiveEngine.prototype["tick"] = originalTick;
    engine.close();
  });

  test("should fallback to NORMAL if histogram is null on tick", () => {
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    const engine = new AdaptiveEngine({ enabled: true });

    // Forcefully simulate tick without histogram to cover early return
    (engine as unknown as { histogram: unknown }).histogram = null;
    (engine as unknown as { tick: () => void }).tick(); // covers `if (this.histogram === null) return;`

    assert.strictEqual(engine.state, "NORMAL");

    console.warn = originalConsoleWarn;
    engine.close();
  });

  test("catch block coverage for initSensor in native ESM", async () => {
    let warnMessage = "";
    const originalConsoleWarn = console.warn;
    console.warn = (msg: string) => {
      warnMessage = msg;
    };

    try {
      // Passing invalid resolutionMs (-1) causes node:perf_hooks monitorEventLoopDelay to throw,
      // triggering the initSensor try/catch block cleanly in native ESM.
      const engine = new AdaptiveEngine({ enabled: true, resolutionMs: -1 });

      // Wait for background async initSensor microtasks to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(engine.state, "NORMAL");
      assert.strictEqual(
        warnMessage.includes(
          "[Volten] Adaptive Triage is enabled but node:perf_hooks is not available",
        ),
        true,
      );
      engine.close();
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  test("should handle state transitions based on event loop lag", () => {
    const engine = new AdaptiveEngine({
      enabled: true,
      warningThresholdMs: 40,
      criticalThresholdMs: 100,
    });

    const mockHistogram = {
      enable: () => true,
      disable: () => true,
      reset: () => {},
      percentile: () => 0,
      max: 0,
    };

    (engine as unknown as { histogram: unknown }).histogram = mockHistogram;

    // Simulate NORMAL (< 40ms)
    mockHistogram.max = 20 * 1e6; // 20ms in nanoseconds
    (engine as unknown as { tick: () => void }).tick();
    assert.strictEqual(engine.state, "NORMAL");
    assert.strictEqual(engine.shouldDrop("low"), false);
    assert.strictEqual(engine.shouldDrop("critical"), false);

    // Simulate WARNING (> 40ms)
    mockHistogram.max = 50 * 1e6; // 50ms in nanoseconds
    (engine as unknown as { tick: () => void }).tick();
    assert.strictEqual(engine.state, "WARNING");
    assert.strictEqual(engine.shouldDrop("low"), true);
    assert.strictEqual(engine.shouldDrop("normal"), false);
    assert.strictEqual(engine.shouldDrop("critical"), false);

    // Simulate CRITICAL (> 100ms)
    mockHistogram.max = 150 * 1e6; // 150ms in nanoseconds
    (engine as unknown as { tick: () => void }).tick();
    assert.strictEqual(engine.state, "CRITICAL");
    assert.strictEqual(engine.shouldDrop("low"), true);
    assert.strictEqual(engine.shouldDrop("normal"), true);
    assert.strictEqual(engine.shouldDrop(undefined), true); // default to normal
    assert.strictEqual(engine.shouldDrop("critical"), false);

    engine.close();
  });

  test("should not drop requests when disabled", () => {
    const engine = new AdaptiveEngine({ enabled: false });

    // Force state to CRITICAL manually to test shouldDrop logic bypass
    engine.state = "CRITICAL";

    assert.strictEqual(engine.shouldDrop("low"), false);
    assert.strictEqual(engine.shouldDrop("normal"), false);
    assert.strictEqual(engine.shouldDrop("critical"), false);

    engine.close();
  });
});
