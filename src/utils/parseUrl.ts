import type { Query } from "../core/types.ts";

function safeDecode(str: string): string {
  if (str.indexOf("%") === -1) return str;
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function safeDecodeQuery(str: string): string {
  if (str.indexOf("%") === -1 && str.indexOf("+") === -1) return str;
  return safeDecode(str.replace(/\+/g, " "));
}

export function parseUrl(url: string) {
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }

  let start = 0;

  if (url.startsWith("http")) {
    const protocolEnd = url.indexOf("://");
    if (protocolEnd !== -1) {
      start = protocolEnd + 3;
    }
  } else if (url.startsWith("//")) {
    start = 2;
  }

  const pathStart = start === 0 ? 0 : url.indexOf("/", start);

  if (pathStart === -1 && start !== 0) {
    const qIdx = url.indexOf("?");
    return { pathname: "/", queryStr: qIdx === -1 ? "" : url.slice(qIdx + 1) };
  }
  const remaining = pathStart === -1 ? url : url.substring(pathStart);
  const queryIndex = remaining.indexOf("?");

  if (queryIndex === -1) {
    const pathname =
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      remaining.endsWith("/") && remaining.length > 1 ? remaining.slice(0, -1) : remaining || "/";
    return {
      pathname: safeDecode(pathname),
      queryStr: "",
    };
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  let pathname = remaining.slice(0, queryIndex) || "/";
  if (pathname.endsWith("/") && pathname.length > 1) {
    pathname = pathname.slice(0, -1);
  }

  return {
    pathname: safeDecode(pathname),
    queryStr: remaining.substring(queryIndex + 1),
  };
}

function splitFirst(str: string, delimiter: string) {
  const index = str.indexOf(delimiter);

  if (index === -1) {
    return [str, ""];
  }

  return [str.slice(0, index), str.slice(index + delimiter.length)];
}

export function parseQuery(queryStr: string): Query {
  const query: Query = {};
  if (queryStr == "") return query;

  const pairs = queryStr.split("&").filter(Boolean);
  for (const pairStr of pairs) {
    const pair = splitFirst(pairStr, "=");
    try {
      const key = safeDecodeQuery(pair[0] ?? "");
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      const value = pair[1] !== undefined ? safeDecodeQuery(pair[1]) : "";

      if (query[key] !== undefined) {
        if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      } else {
        query[key] = value;
      }
    } catch {
      continue;
    }
  }
  return query;
}

/**
 * Fast pathname and search extractor for Edge runtime Request URLs.
 * Extracts `pathname + search` without the heavy overhead of WHATWG `new URL()`.
 * Falls back to WHATWG `new URL()` when non-standard patterns, dot segments (/.),
 * backslashes, non-ASCII characters, or non-http protocols are encountered.
 */
export function extractEdgePathAndSearch(urlStr: string): string {
  let pathStart = -1;
  const len = urlStr.length;

  if (urlStr.charCodeAt(0) === 104 /* h */) {
    let schemeLen = -1;
    if (urlStr.startsWith("http://")) {
      schemeLen = 7;
    } else if (urlStr.startsWith("https://")) {
      schemeLen = 8;
    }

    if (schemeLen !== -1) {
      if (urlStr.charCodeAt(schemeLen) === 47 /* / */) {
        // e.g. http:///a (empty host) -> WHATWG treats next component as host
        try {
          const u = new URL(urlStr);
          return u.pathname + u.search;
        } catch {
          return urlStr;
        }
      }

      const slashIdx = urlStr.indexOf("/", schemeLen);
      const qIdx = urlStr.indexOf("?", schemeLen);
      const hashIdx = urlStr.indexOf("#", schemeLen);

      let authorityEnd = len;
      if (qIdx !== -1 && qIdx < authorityEnd) authorityEnd = qIdx;
      if (hashIdx !== -1 && hashIdx < authorityEnd) authorityEnd = hashIdx;

      if (slashIdx !== -1 && slashIdx < authorityEnd) {
        pathStart = slashIdx;
      } else {
        // No path slash before query or hash -> empty path e.g. http://example.com?query
        const hostLen = authorityEnd - schemeLen;
        if (hostLen <= 0) {
          // e.g. https://#/ (empty host) -> invalid URL in WHATWG
          try {
            const u = new URL(urlStr);
            return u.pathname + u.search;
          } catch {
            return urlStr;
          }
        }
        if (qIdx !== -1 && (hashIdx === -1 || qIdx < hashIdx)) {
          const search = hashIdx === -1 ? urlStr.slice(qIdx) : urlStr.slice(qIdx, hashIdx);
          for (let i = 0; i < search.length; i++) {
            const c = search.charCodeAt(i);
            if (c <= 32 || c === 92 || c >= 127) {
              try {
                const u = new URL(urlStr);
                return u.pathname + u.search;
              } catch {
                return urlStr;
              }
            }
          }
          return search.length <= 1 ? "/" : "/" + search;
        }
        return "/";
      }
    }
  } else if (urlStr.charCodeAt(0) === 47 /* / */) {
    if (urlStr.charCodeAt(1) === 47 /* / */) {
      // Protocol-relative URLs are not valid absolute Request URLs in Web Standards
      // Fallback directly to match WHATWG Request constructor / new URL behavior
      try {
        const u = new URL(urlStr);
        return u.pathname + u.search;
      } catch {
        return urlStr;
      }
    } else {
      // Relative path string provided directly in tests or internal callers
      return urlStr;
    }
  }

  if (pathStart === -1) {
    // Unknown scheme or invalid -> fallback
    try {
      const u = new URL(urlStr);
      return u.pathname + u.search;
    } catch {
      return urlStr;
    }
  }

  const hashIdx = urlStr.indexOf("#", pathStart);
  const end = hashIdx === -1 ? len : hashIdx;

  const qIdx = urlStr.indexOf("?", pathStart);
  let pathnameEnd = end;
  let search = "";
  if (qIdx !== -1 && qIdx < end) {
    pathnameEnd = qIdx;
    if (end > qIdx + 1) {
      search = urlStr.slice(qIdx, end);
    }
  }

  // Fast path safety scan across the candidate:
  // 1. Whitespace, control chars (<= 32), backslash (92), or non-ASCII (>= 127)
  // 2. Dot segments (/.) or percent-encoded dot segments (/%2e, /%2E)
  for (let i = pathStart; i < end; i++) {
    const code = urlStr.charCodeAt(i);
    if (code <= 32 || code === 92 || code >= 127) {
      try {
        const u = new URL(urlStr);
        return u.pathname + u.search;
      } catch {
        return urlStr.slice(pathStart, end);
      }
    } else if (i < pathnameEnd) {
      if (code === 46 /* . */) {
        if (i === pathStart || urlStr.charCodeAt(i - 1) === 47 /* / */) {
          try {
            const u = new URL(urlStr);
            return u.pathname + u.search;
          } catch {
            return urlStr.slice(pathStart, end);
          }
        }
      } else if (code === 37 /* % */ && i + 2 < pathnameEnd) {
        const c1 = urlStr.charCodeAt(i + 1);
        const c2 = urlStr.charCodeAt(i + 2);
        if (c1 === 50 /* 2 */ && (c2 === 101 /* e */ || c2 === 69) /* E */) {
          if (i === pathStart || urlStr.charCodeAt(i - 1) === 47 /* / */) {
            try {
              const u = new URL(urlStr);
              return u.pathname + u.search;
            } catch {
              return urlStr.slice(pathStart, end);
            }
          }
        }
      }
    }
  }

  const pathname = urlStr.slice(pathStart, pathnameEnd);
  return pathname + search;
}
