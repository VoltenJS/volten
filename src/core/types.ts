import { IncomingMessage, ServerResponse, IncomingHttpHeaders } from "http";
import { PathNode, RouteTree } from "../utils/routetree.ts";
import { App } from "../core/server.ts";
import { RequestContext } from "../utils/requestctx.ts";
import { MethodStorage } from "../utils/routetree.ts";

export type Next = () => Promise<void> | void;

export type VoltenHandler = (
  ctx: RequestContext,
  next: Next,
) => Promise<void> | void;

export type PreflightHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export type GenericErrorHandler = (
  err: Error,
  ctx: RequestContext,
) => void | Promise<void>;

export type RawErrorHandler = (
  err: Error,
  res: ServerResponse,
) => void | Promise<void>;

export type Params = Record<string, any>;
export type Query = Record<string, string | string[]>;

export interface FingerPrintData {
  stableCount: number;
  JITcompiler: Function | null;
}

export type RouteData = [
  path: string,
  method: string,
  middleware: VoltenHandler[],
  handler: VoltenHandler,
  composeChain: VoltenHandler,
  options: Required<RouteOptions>,
];

export type PathData = {
  method: string;
  bodyLimit: number;
  middleware: VoltenHandler[];
  handler: VoltenHandler;
  composeChain: VoltenHandler;
  lastFingerprint: number;
  setFingerprint: (fingerprint: number) => void;
  setDeOpt: () => void;
  disableOpt: boolean;
  methodStroage: MethodStorage;
};

export type HostData = {
  tree: RouteTree;
  middleware: VoltenHandler[];
  immediate: Map<string, string>;
  hostOptions: Required<VoltenAppOptions>;
};

export type HTTPMethodParams = [path: string, ...handlers: VoltenHandler[]];

export type PathNodeChildren = {
  static: Record<string, PathNode>;
  param: PathNode | null;
};

export type JSONResponseOptions = {
  static?: boolean;
  schema: object;
};

export type SendFileOptions = {
  download?: string;
  errCallback?: GenericErrorHandler;
};

export type VoltenAppOptions = {
  express?: boolean;
  bodyLimit?: number;
  caseInsensitive?: boolean;
  RequestPoolSize?: number;
};

export type RouteOptions = {
  bodyLimit?: number;
};

export const DeafultVoltenOptions: Required<VoltenAppOptions> = {
  express: false,
  bodyLimit: 1024 * 1024,
  caseInsensitive: true,
  RequestPoolSize: 2048,
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
