import util from "node:util";
import type {
  CustomLoggerOptions,
  DefaultLevels,
  Logger,
  LoggerSerializerFn,
} from "../core/types.ts";

function serializeError(err: Error): Record<string, unknown> {
  const { name, message, stack, ...rest } = err;

  return {
    type: name,
    message,
    stack,
    ...rest,
  };
}

function redactObject(obj: Record<string, unknown>, redactKeys: string[]): Record<string, unknown> {
  if (redactKeys.length === 0) return obj;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (redactKeys.includes(key)) {
      result[key] = "[REDACTED]";
    } else if (value instanceof Error) {
      result[key] = serializeError(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, redactKeys);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function createLogger<CustomLevels extends string = never>(
  options: CustomLoggerOptions<CustomLevels> = {},
): Logger<CustomLevels> {
  let currentLevelName = options.level ?? "info";
  const redactKeys = options.redact ?? [];
  const baseContext = options.baseContext ?? {};
  const pretty = options.pretty ?? false;
  const mixinFn = options.mixin;
  const serializers: Record<string, LoggerSerializerFn> = options.serializers ?? {};
  const timestampOption = options.timestamp ?? true;

  const levelPriorities: Record<string, number> = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
    ...options.customLevels,
  };

  let currentPriority = levelPriorities[currentLevelName] ?? 30;

  function applySerializers(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (serializers[k] !== undefined) {
        result[k] = serializers[k](v);
      } else if (v instanceof Error) {
        result[k] = serializeError(v);
      } else {
        result[k] = v;
      }
    }

    return result;
  }

  function writeLog(level: string, firstArg: unknown, ...rest: unknown[]) {
    const dynamicMixin = mixinFn !== undefined ? mixinFn() : {};

    let logPayload: Record<string, unknown> = {
      level,
      pid: process.pid,
      ...baseContext,
      ...dynamicMixin,
    };

    if (timestampOption !== false) {
      logPayload["time"] =
        typeof timestampOption === "function" ? timestampOption() : new Date().toISOString();
    }

    let message = "";

    if (firstArg instanceof Error) {
      logPayload["err"] = serializeError(firstArg);
      if (typeof rest[0] === "string") {
        const [msgTemplate, ...formatArgs] = rest;
        message = util.format(msgTemplate, ...formatArgs);
      }
    } else if (typeof firstArg === "object" && firstArg !== null) {
      const processedObj = applySerializers(firstArg as Record<string, unknown>);
      logPayload = { ...logPayload, ...processedObj };

      if (typeof rest[0] === "string") {
        const [msgTemplate, ...formatArgs] = rest;
        message = util.format(msgTemplate, ...formatArgs);
      }
    } else if (typeof firstArg === "string") {
      message = util.format(firstArg, ...rest);
    }

    if (message !== "") {
      logPayload["msg"] = message;
    }

    const sanitizedPayload = redactObject(logPayload, redactKeys);
    const output = pretty
      ? JSON.stringify(sanitizedPayload, null, 2)
      : JSON.stringify(sanitizedPayload);

    console.info(output);
  }

  const logger = {} as Record<string, unknown>;

  for (const [level, targetPriority] of Object.entries(levelPriorities)) {
    logger[level] = (firstArg: unknown, ...rest: unknown[]) => {
      if (targetPriority >= currentPriority) {
        writeLog(level, firstArg, ...rest);
      }
    };
  }

  Object.defineProperty(logger, "level", {
    get: () => currentLevelName,
    set: (newLevel: DefaultLevels | CustomLevels) => {
      if (levelPriorities[newLevel] !== undefined) {
        currentLevelName = newLevel;
        currentPriority = levelPriorities[newLevel];
      }
    },
    enumerable: true,
    configurable: true,
  });

  logger["isLevelEnabled"] = (level: DefaultLevels | CustomLevels): boolean => {
    const priority = levelPriorities[level];
    return priority !== undefined && priority >= currentPriority;
  };

  logger["child"] = (bindings: Record<string, unknown>) => {
    return createLogger({
      ...options,
      baseContext: {
        ...baseContext,
        ...bindings,
      },
    });
  };

  return logger as Logger<CustomLevels>;
}
