import { IncomingMessage, ServerResponse } from "http";
import { RequestContext } from "../utils/requestCtx.ts";
import { MethodStorage } from "../utils/routeTree.ts";
import { VoltenError } from "./errors.ts";
import { Readable } from "stream";

export type Next = () => Promise<void> | void;

type ExtractParamKeys<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractParamKeys<Rest>
  : T extends `${string}:${infer Param}`
    ? Param
    : T extends `${string}*${infer Rest}`
      ? "*" | ExtractParamKeys<Rest>
      : never;

export type ExtractParams<T extends string> = string extends T
  ? Record<string, string>
  : [ExtractParamKeys<T>] extends [never]
    ? Record<string, never>
    : { [K in ExtractParamKeys<T>]: string };

export type VoltenHandler<P extends string = string> = (
  ctx: RequestContext<P>,
  next: Next,
) => Promise<void> | void;

export type VoltenChainHandler<P extends string = string> = (
  ctx: RequestContext<P>,
) => Promise<void> | void;

export type PreflightHandler<P extends string = string> = (
  ctx: RequestContext<P>,
) => Promise<void> | void;

export type ErrorHandler<P extends string = string> = (
  err: VoltenError,
  ctx: RequestContext<P>,
) => Promise<void> | void;

export type DefaultErrorHandler<P extends string = string> = (
  err: VoltenError,
  ctx: RequestContext<P>,
) => void;

export type NativeErrorHandler = (
  err: VoltenError,
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export type Params = Record<string, string>;
export type Query = Record<string, string | string[]>;

export type SerializerFn = (data: unknown, ctx?: unknown) => string;

export interface FingerPrintData {
  stableCount: number;
  JITcompiler: SerializerFn | null;
}

export type RouteData = [
  path: string,
  method: string,
  routeHandlers: VoltenHandler[],
  options: Required<RouteOptions>,
];

export type RoutePriority = "critical" | "normal" | "low";

export type AdaptiveTriageOptions = {
  enabled?: boolean;
  warningThresholdMs?: number;
  criticalThresholdMs?: number;
  resolutionMs?: number;
  checkIntervalMs?: number;
};

export type PathData = {
  method: string;
  bodyLimit: number | null;
  priority: RoutePriority;
  composeChain: VoltenChainHandler;
  serializer?: (data: unknown) => string;
  setDeOpt: () => void;
  disableOpt: boolean;
  methodStorage: MethodStorage;
  paramNames?: string[];
};

export type HTTPMethodParams = [path: string, ...handlers: VoltenHandler[]];

export type JSONResponseOptions = {
  static?: boolean;
  schema: object;
};

export type SendFileOptions = {
  download?: string;
  errCallback?: ErrorHandler;
};

export type VoltenHttpsOptions = {
  /** The full private key as a string */
  key: string;
  /** The full certificate as a string */
  cert: string;
};

export type VoltenAppOptions<CustomLevels extends string = never> = {
  bodyLimit?: number;
  caseInsensitive?: boolean;
  RequestPoolSize?: number;
  noLogs?: boolean;
  https?: VoltenHttpsOptions | undefined;
  loggerOptions?: CustomLoggerOptions<CustomLevels>;
  adaptiveTriage?: AdaptiveTriageOptions;
};

export const DefaultVoltenOptions: Required<VoltenAppOptions> = {
  bodyLimit: 1024 * 1024,
  caseInsensitive: true,
  RequestPoolSize: 2048,
  noLogs: false,
  https: undefined,
  loggerOptions: {
    level: "warn",
  },
  adaptiveTriage: {
    enabled: false,
    warningThresholdMs: 40,
    criticalThresholdMs: 100,
    resolutionMs: 10,
    checkIntervalMs: 500,
  },
};

export type RouteOptions = {
  bodyLimit?: number | null;
  priority?: RoutePriority;
};

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
};

export type FileController = { enqueue: (c: Uint8Array) => void; close: () => void };
export interface MultipartFile {
  isFile: true;
  name: string;
  filename: string;
  contentType?: string;
  stream: Readable | ReadableStream;
  /** Saves the file to disk. Automatically creates missing directories. */
  save: (targetPath: string) => Promise<void>;
  /** Materializes the stream completely into a Buffer */
  buffer: () => Promise<Buffer>;
  /** Materializes the stream completely into a UTF-8 String */
  text: () => Promise<string>;
}

export interface MultipartField {
  isFile: false;
  name: string;
  value: string;
}

export type MultipartPart = MultipartFile | MultipartField;

export const NOT_FOUND_BUF = Buffer.from("Not Found");
export const NOT_FOUND_HEADERS = {
  Connection: "close",
  "content-type": "text/plain; charset=utf-8",
  "content-length": NOT_FOUND_BUF.length,
};

export const SERVICE_UNAVAILABLE_BUF = Buffer.from("Service Unavailable");
export const SERVICE_UNAVAILABLE_HEADERS = {
  Connection: "close",
  "content-type": "text/plain; charset=utf-8",
  "content-length": SERVICE_UNAVAILABLE_BUF.length,
};

export const PAYLOAD_TOO_LARGE_BUF = Buffer.from("Payload Too Large");
export const PAYLOAD_TOO_LARGE_HEADERS = {
  Connection: "close",
  "content-type": "text/plain; charset=utf-8",
  "content-length": PAYLOAD_TOO_LARGE_BUF.length,
};

export const INTERNAL_SERVER_ERROR_BUF = Buffer.from("Internal Server Error");
export const INTERNAL_SERVER_ERROR_HEADERS = {
  Connection: "close",
  "content-type": "text/plain; charset=utf-8",
  "content-length": INTERNAL_SERVER_ERROR_BUF.length,
};

// Logger

export interface LogFn {
  (msg: unknown, ...args: unknown[]): void;
  (obj: Record<string, unknown> | Error, msg?: string, ...args: unknown[]): void;
}

export type DefaultLevels = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export type LoggerSerializerFn = (value: unknown) => unknown;

export interface CustomLoggerOptions<CustomLevels extends string = never> {
  level?: DefaultLevels | CustomLevels;
  customLevels?: Record<CustomLevels, number>;
  redact?: string[];
  baseContext?: Record<string, unknown>;
  pretty?: boolean;
  mixin?: () => Record<string, unknown>;
  serializers?: Record<string, LoggerSerializerFn>;
  timestamp?: boolean | (() => string);
}

export type Logger<CustomLevels extends string = never> = {
  [K in DefaultLevels | CustomLevels]: LogFn;
} & {
  level: DefaultLevels | CustomLevels;
  child(bindings: Record<string, unknown>): Logger<CustomLevels>;
  isLevelEnabled(level: DefaultLevels | CustomLevels): boolean;
};
