import type { CookieOptions } from "../core/types.ts";

const NULL_BODY_STATUSES = new Set([204, 304]);

export function shouldSendContent(method: string | undefined, status: number): boolean {
  if (method !== undefined && method.toUpperCase() === "HEAD") return false;
  if (NULL_BODY_STATUSES.has(status)) return false;
  if (status >= 100 && status < 200) return false;
  return true;
}

export function extractMediaType(contentType: string): string {
  const semi = contentType.indexOf(";");
  const raw = semi === -1 ? contentType : contentType.slice(0, semi);
  return raw.trim().toLowerCase();
}

export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export function isUrlEncodedMediaType(mediaType: string): boolean {
  return mediaType === "application/x-www-form-urlencoded";
}

export function normalizeEtag(tag: string): string {
  let t = tag.trim();
  if (t.length >= 2 && (t.startsWith("W/") || t.startsWith("w/"))) {
    t = t.slice(2).trim();
  }
  return t;
}

export function ifNoneMatchMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch === undefined) return false;
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.includes("*")) return true;
  const current = normalizeEtag(etag);
  for (const part of parts) {
    if (normalizeEtag(part) === current) return true;
  }
  return false;
}

export function serializeSetCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  let str = encodeURIComponent(name) + "=" + encodeURIComponent(value);
  if (options.path !== undefined) {
    str += "; Path=" + options.path;
  } else {
    str += "; Path=/";
  }

  if (options.maxAge !== undefined) {
    str += "; Max-Age=" + String(options.maxAge);
  }

  if (options.expires !== undefined) {
    str += "; Expires=" + options.expires.toUTCString();
  }

  if (options.domain !== undefined) {
    str += "; Domain=" + options.domain;
  }

  const sameSite = options.sameSite;
  let secure = options.secure === true;
  if (sameSite === "none") {
    secure = true;
  }

  if (sameSite !== undefined) {
    str += "; SameSite=" + (sameSite === "lax" ? "Lax" : sameSite === "strict" ? "Strict" : "None");
  }

  if (secure) {
    str += "; Secure";
  }

  if (options.httpOnly === true) {
    str += "; HttpOnly";
  }
  return str;
}

function unquoteCookieValue(val: string): string {
  if (val.length >= 2 && val.charCodeAt(0) === 34 && val.charCodeAt(val.length - 1) === 34) {
    return val.slice(1, -1);
  }
  return val;
}

export function parseCookieHeader(rawCookieHeader: string): Record<string, string> {
  const parsedCookies: Record<string, string> = Object.create(null) as Record<string, string>;
  let start = 0;
  const len = rawCookieHeader.length;
  while (start < len) {
    while (start < len && rawCookieHeader.charCodeAt(start) === 32) {
      start++;
    }
    if (start >= len) break;
    const equalsIdx = rawCookieHeader.indexOf("=", start);
    if (equalsIdx === -1) break;
    let semiIdx = rawCookieHeader.indexOf(";", equalsIdx);
    if (semiIdx === -1) {
      semiIdx = len;
    }
    const rawKey = rawCookieHeader.slice(start, equalsIdx).trim();
    if (rawKey.length === 0) {
      start = semiIdx + 1;
      continue;
    }
    const rawVal = unquoteCookieValue(rawCookieHeader.slice(equalsIdx + 1, semiIdx).trim());
    try {
      parsedCookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal);
    } catch {
      parsedCookies[rawKey] = rawVal;
    }
    start = semiIdx + 1;
  }
  return parsedCookies;
}

export function contentDispositionAttachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodedName}`;
}

export function isSetCookieHeaderName(header: string): boolean {
  return header.toLowerCase() === "set-cookie";
}

export function joinAllowHeader(methods: readonly string[]): string {
  return methods.join(", ");
}
