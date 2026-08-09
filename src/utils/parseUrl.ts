import type { Query } from "../core/types.ts";

export function parseUrl(url: string) {
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
    return { pathname: "/", queryStr: url.includes("?") ? url.slice(url.indexOf("?")) : "" };
  }
  const remaining = pathStart === -1 ? url : url.substring(pathStart);
  const queryIndex = remaining.indexOf("?");

  if (queryIndex === -1) {
    return {
      pathname:
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        remaining.endsWith("/") && remaining.length > 1 ? remaining.slice(0, -1) : remaining || "/",
      queryStr: "",
    };
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  let pathname = remaining.slice(0, queryIndex) || "/";
  if (pathname.endsWith("/") && pathname.length > 1) {
    pathname = pathname.slice(0, -1);
  }

  return {
    pathname,
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
      const key = decodeURIComponent(pair[0] ?? "");
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      const value = pair[1] !== undefined ? decodeURIComponent(pair[1].replace(/\+/g, " ")) : "";

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
