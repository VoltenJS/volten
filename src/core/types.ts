import { IncomingMessage, ServerResponse } from "http";
import { RouteTree } from "../utils/routeTree.ts";
import { RequestContext } from "../utils/requestCtx.ts";
import { MethodStorage } from "../utils/routeTree.ts";
import { VoltenError } from "./errors.ts";
import { Readable } from "stream";

export type Next = () => Promise<void> | void;

export type VoltenHandler = (ctx: RequestContext, next: Next) => Promise<void> | void;

export type VoltenChainHandler = (ctx: RequestContext) => Promise<void> | void;

export type PreflightHandler = (ctx: RequestContext) => Promise<void> | void;

export type ErrorHandler = (err: VoltenError, ctx: RequestContext) => Promise<void> | void;

export type NativeErrorHandler = (
  err: VoltenError,
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export type Params = Record<string, unknown>;
export type Query = Record<string, string | string[]>;

export type JitCompilerFunction = (d: unknown, ctx: RequestContext) => void;

export interface FingerPrintData {
  stableCount: number;
  JITcompiler: JitCompilerFunction | null;
}

export type RouteData = [
  path: string,
  method: string,
  routeHandlers: VoltenHandler[],
  options: Required<RouteOptions>,
];

export type PathData = {
  method: string;
  bodyLimit: number | null;
  composeChain: VoltenChainHandler;
  lastFingerprint: number;
  setFingerprint: (fingerprint: number) => void;
  setDeOpt: () => void;
  disableOpt: boolean;
  methodStorage: MethodStorage;
};

export type HostData = {
  tree: RouteTree;
  middleware: VoltenHandler[];
  immediate: Map<string, string>;
  hostOptions: Required<VoltenAppOptions>;
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

export type VoltenAppOptions = {
  bodyLimit?: number;
  caseInsensitive?: boolean;
  RequestPoolSize?: number;
  noLogs?: boolean;
};

export type RouteOptions = {
  bodyLimit?: number | null;
};

export const DeafultVoltenOptions: Required<VoltenAppOptions> = {
  bodyLimit: 1024 * 1024,
  caseInsensitive: true,
  RequestPoolSize: 2048,
  noLogs: false,
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

export interface MultipartFile {
  isFile: true;
  name: string;
  filename: string;
  contentType?: string;
  stream: Readable;
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
