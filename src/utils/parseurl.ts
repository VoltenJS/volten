import { Query } from "../core/types.ts";

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
    return { pathname: "/", queryStr: "" };
  }
  const remaining = pathStart === -1 ? url : url.substring(pathStart);
  const queryIndex = remaining.indexOf("?");

  if (queryIndex === -1) {
    return {
      pathname:
        remaining.endsWith("/") && remaining.length > 1
          ? remaining.slice(0, -1)
          : remaining || "/",
      queryStr: "",
    };
  }

  let pathname = remaining.substring(0, queryIndex) || "/";
  if (pathname.endsWith("/") && pathname.length > 1) {
    pathname = pathname.slice(0, -1);
  }

  return {
    pathname,
    queryStr: remaining.substring(queryIndex + 1),
  };
}
export function parseQuery(queryStr: string): Query {
  const query: Query = {};
  if (!queryStr) return query;

  const pairs = queryStr.split("&").filter(Boolean);
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split("=");
    const key = decodeURIComponent(pair[0]);
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    const value = pair[1]
      ? decodeURIComponent(pair[1].replace(/\+/g, " "))
      : "";

    if (query[key]) {
      if (Array.isArray(query[key])) {
        (query[key] as string[]).push(value);
      } else {
        query[key] = [query[key] as string, value];
      }
    } else {
      query[key] = value;
    }
  }
  return query;
}
