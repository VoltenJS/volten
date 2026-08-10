import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../../src/utils/logger.ts";

// Helper function to capture logs written to console.info
function captureLogs(fn: () => void): any[] {
  const originalInfo = console.info;
  const logs: any[] = [];
  console.info = (output: any) => {
    logs.push(JSON.parse(output));
  };
  try {
    fn();
  } finally {
    console.info = originalInfo;
  }
  return logs;
}

test("createLogger: default initialization and baseline logs", () => {
  const logger = createLogger();

  // Default level is info
  assert.equal(logger.level, "info");
  assert.equal(logger.isLevelEnabled("info"), true);
  assert.equal(logger.isLevelEnabled("debug"), false);
  assert.equal(logger.isLevelEnabled("error"), true);

  const logs = captureLogs(() => {
    logger.info("Hello world");
    logger.debug("Should not be logged");
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[0].msg, "Hello world");
  assert.equal(typeof logs[0].pid, "number");
  assert.equal(typeof logs[0].time, "string");
});

test("createLogger: level thresholds and custom level name validation", () => {
  const logger = createLogger({ level: "warn" });
  assert.equal(logger.level, "warn");

  const logs = captureLogs(() => {
    logger.info("Info log");
    logger.warn("Warn log");
    logger.error("Error log");
  });

  assert.equal(logs.length, 2);
  assert.equal(logs[0].level, "warn");
  assert.equal(logs[0].msg, "Warn log");
  assert.equal(logs[1].level, "error");
  assert.equal(logs[1].msg, "Error log");
});

test("createLogger: dynamic level set and get", () => {
  const logger = createLogger({ level: "info" });
  assert.equal(logger.level, "info");

  // Change level to debug
  logger.level = "debug";
  assert.equal(logger.level, "debug");

  const logs = captureLogs(() => {
    logger.debug("Debug log is now enabled");
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, "Debug log is now enabled");

  // Attempt to set invalid level (should be ignored)
  logger.level = "invalid_level" as any;
  assert.equal(logger.level, "debug");
});

test("createLogger: custom levels option", () => {
  const logger = createLogger<"custom">({
    level: "custom" as any,
    customLevels: { custom: 25 } as any,
  });

  assert.equal(logger.level, "custom");
  assert.equal(logger.isLevelEnabled("custom" as any), true);
  assert.equal(logger.isLevelEnabled("debug"), false); // debug is 20, current is 25

  const logs = captureLogs(() => {
    (logger as any).custom("Custom level message");
    logger.info("Info message (30 >= 25)");
    logger.debug("Debug message (20 < 25)");
  });

  assert.equal(logs.length, 2);
  assert.equal(logs[0].level, "custom");
  assert.equal(logs[0].msg, "Custom level message");
  assert.equal(logs[1].level, "info");
  assert.equal(logs[1].msg, "Info message (30 >= 25)");
});

test("createLogger: baseContext, mixin, and dynamic mixin inclusion", () => {
  const mixinFn = () => ({
    dynamicVal: "dynamic",
    time: "should-not-override-built-in-unless-before", // Actually, in code:
    // pid, ...baseContext, ...dynamicMixin, then timestamp is added if timestampOption !== false
  });

  const logger = createLogger({
    baseContext: { app: "volten", version: "1.0.0" },
    mixin: mixinFn,
  });

  const logs = captureLogs(() => {
    logger.info("Context log");
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].app, "volten");
  assert.equal(logs[0].version, "1.0.0");
  assert.equal(logs[0].dynamicVal, "dynamic");
  assert.equal(logs[0].msg, "Context log");
});

test("createLogger: timestamp option configurations", () => {
  // 1. timestampOption = false
  const loggerNoTime = createLogger({ timestamp: false });
  const logsNoTime = captureLogs(() => {
    loggerNoTime.info("No time");
  });
  assert.equal(logsNoTime[0].time, undefined);

  // 2. timestampOption as custom function
  const loggerCustomTime = createLogger({ timestamp: () => "constant-timestamp" });
  const logsCustomTime = captureLogs(() => {
    loggerCustomTime.info("Custom time");
  });
  assert.equal(logsCustomTime[0].time, "constant-timestamp");
});

test("createLogger: serializers application", () => {
  const logger = createLogger({
    serializers: {
      req: (req: any) => ({ method: req.method, url: req.url }),
      user: (u: any) => u.name.toUpperCase(),
    },
  });

  const errorInstance = new Error("Serializer fallback test error");

  const logs = captureLogs(() => {
    logger.info({
      req: { method: "GET", url: "/api", headers: {} },
      user: { name: "alice" },
      unserialized: "hello",
      errFallback: errorInstance,
    });
  });

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].req, { method: "GET", url: "/api" });
  assert.equal(logs[0].user, "ALICE");
  assert.equal(logs[0].unserialized, "hello");
  assert.equal(logs[0].errFallback.type, "Error");
  assert.equal(logs[0].errFallback.message, "Serializer fallback test error");
  assert.equal(typeof logs[0].errFallback.stack, "string");
});

test("createLogger: error argument handling", () => {
  const logger = createLogger();
  const customErr = new Error("Database failed");
  (customErr as any).code = "DB_ERR";

  const logs = captureLogs(() => {
    // 1. Error with string message + formatting args
    logger.error(customErr, "Failed loading item %s", "123");
    // 2. Error with no message format
    logger.error(customErr);
  });

  assert.equal(logs.length, 2);

  assert.equal(logs[0].err.type, "Error");
  assert.equal(logs[0].err.message, "Database failed");
  assert.equal(logs[0].err.code, "DB_ERR");
  assert.equal(logs[0].msg, "Failed loading item 123");

  assert.equal(logs[1].err.message, "Database failed");
  assert.equal(logs[1].msg, undefined);
});

test("createLogger: object argument handling and formatting", () => {
  const logger = createLogger();
  const logs = captureLogs(() => {
    // 1. Object with string template and formatting args
    logger.info({ transactionId: "tx_99" }, "Processed payload for user %s", "bob");
    // 2. Object with no message format
    logger.info({ rawValue: 42 });
  });

  assert.equal(logs.length, 2);
  assert.equal(logs[0].transactionId, "tx_99");
  assert.equal(logs[0].msg, "Processed payload for user bob");

  assert.equal(logs[1].rawValue, 42);
  assert.equal(logs[1].msg, undefined);
});

test("createLogger: string argument formatting", () => {
  const logger = createLogger();
  const logs = captureLogs(() => {
    logger.info("Formatted %s with code %d", "string", 200);
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, "Formatted string with code 200");
});

test("createLogger: other data types in firstArg", () => {
  const logger = createLogger();
  const logs = captureLogs(() => {
    // firstArg is a number (not Error, Object, or String)
    logger.info(12345);
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, undefined);
});

test("createLogger: redaction of keys", () => {
  const errorInstance = new Error("Redaction nested error");
  const logger = createLogger({
    redact: ["password", "token"],
  });

  const logs = captureLogs(() => {
    logger.info({
      password: "secret_password",
      token: "secret_token",
      publicData: "visible",
      nested: {
        password: "nested_password",
        token: "nested_token",
        ok: "nested_ok",
        errVal: errorInstance,
        nullVal: null,
        arrVal: [1, 2, 3],
      },
    });
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].password, "[REDACTED]");
  assert.equal(logs[0].token, "[REDACTED]");
  assert.equal(logs[0].publicData, "visible");
  assert.equal(logs[0].nested.password, "[REDACTED]");
  assert.equal(logs[0].nested.token, "[REDACTED]");
  assert.equal(logs[0].nested.ok, "nested_ok");
  assert.equal(logs[0].nested.errVal.type, "Error");
  assert.equal(logs[0].nested.errVal.message, "Redaction nested error");
  assert.equal(logs[0].nested.nullVal, null);
  assert.deepEqual(logs[0].nested.arrVal, [1, 2, 3]);
});

test("createLogger: pretty printing configuration", () => {
  const logger = createLogger({ pretty: true });

  const originalInfo = console.info;
  let lastOutput = "";
  console.info = (output: any) => {
    lastOutput = output;
  };

  try {
    logger.info("Pretty test");
  } finally {
    console.info = originalInfo;
  }

  // If pretty printed, it should contain newlines and spacing indentation
  assert.ok(lastOutput.includes("\n"));
  assert.ok(lastOutput.includes('  "msg": "Pretty test"'));
});

test("createLogger: child loggers creation and property inheritance", () => {
  const logger = createLogger({
    level: "debug",
    baseContext: { parentKey: "parent" },
    redact: ["secret"],
    timestamp: false,
  });

  const childLogger = logger.child({ childKey: "child" });

  assert.equal(childLogger.level, "debug");

  const logs = captureLogs(() => {
    childLogger.info({ secret: "shh", visible: "ok" }, "Child message");
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].parentKey, "parent");
  assert.equal(logs[0].childKey, "child");
  assert.equal(logs[0].secret, "[REDACTED]");
  assert.equal(logs[0].visible, "ok");
  assert.equal(logs[0].msg, "Child message");
});

test("createLogger: handles invalid current level name during initialization fallback", () => {
  const logger = createLogger({
    level: "non-existent-level" as any,
  });

  // Priority should fallback to 30 (info), and level name keeps "non-existent-level"
  assert.equal(logger.level, "non-existent-level");

  // Since fallback priority is 30 (info), debug (20) shouldn't log, but info (30) should log
  const logs = captureLogs(() => {
    (logger as any).debug("Debug message");
    (logger as any).info("Info message");
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[0].msg, "Info message");
});

test("createLogger: isLevelEnabled returns false for invalid levels", () => {
  const logger = createLogger();
  assert.equal(logger.isLevelEnabled("non-existent-level" as any), false);
});
