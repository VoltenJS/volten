import { VoltenHandler, PathData, RouteOptions } from "../core/types.ts";
import { RequestContext } from "./requestctx.ts";

export class MethodStorage {
  public GET: PathData | null = null;
  public POST: PathData | null = null;
  public PUT: PathData | null = null;
  public PATCH: PathData | null = null;
  public DELETE: PathData | null = null;

  // Could these ".toUpperCase" be removed. (Probably wont matter since it only called on server start)
  set(method: string, data: PathData) {
    const m = method.toUpperCase();
    if (m === "GET") this.GET = data;
    else if (m === "POST") this.POST = data;
    else if (m === "PUT") this.PUT = data;
    else if (m === "PATCH") this.PATCH = data;
    else if (m === "DELETE") this.DELETE = data;
  }

  get(method: string) {
    const m = method.toUpperCase();
    if (m === "GET") return this.GET;
    if (m === "POST") return this.POST;
    if (m === "PUT") return this.PUT;
    if (m === "PATCH") return this.PATCH;
    if (m === "DELETE") return this.DELETE;
    return null;
  }
}

export class PathNode {
  public staticChild: PathNode | null = null;
  public sibling: PathNode | null = null;
  public paramChild: PathNode | null = null;
  public wildcardChild: PathNode | null = null;
  public methods = new MethodStorage();
  public paramName: string | null = null;
  public charCode: number = -1;

  constructor(public prefix: string) {
    this.charCode = prefix.length > 0 ? prefix.charCodeAt(0) : -1;
  }
}

export class RouteTree {
  private root: PathNode = new PathNode("");
  private cache: Map<string, Map<string, PathData>> = new Map();
  private cacheSize = 0;
  private caseInsensitive;
  // To-Do: make this more customizable by dev
  private readonly MAX_CACHE = 10000;

  constructor(caseInsensitive: boolean) {
    this.caseInsensitive = caseInsensitive;
  }

  public addPath(
    method: string,
    path: string,
    middleware: VoltenHandler[] | VoltenHandler,
    handler: VoltenHandler,
    composeChain: VoltenHandler,
    options: Required<RouteOptions>,
  ) {
    const originalPath = path;

    if (this.caseInsensitive) {
      path = path.toLowerCase();
    }

    const routeData: PathData = {
      method,
      bodyLimit: options.bodyLimit,
      handler,
      middleware: Array.isArray(middleware) ? middleware : [middleware],
      composeChain,
      lastFingerprint: 0,
      disableOpt: false,
      setFingerprint: (fingerprint: number) => {},
      setDeOpt: () => {},
      methodStroage: new MethodStorage(),
    };

    let currentNode = this.root;
    let i = 0;

    while (i < path.length) {
      const charCode = path.charCodeAt(i);

      // Handle Parameter Tokens
      if (charCode === 58) {
        // ':'
        let j = i + 1;
        while (j < path.length && path.charCodeAt(j) !== 47) j++;

        // Pull name parameter characters from the original path configuration string to keep variable names casing-accurate
        const name = originalPath.slice(i + 1, j);

        if (!currentNode.paramChild) {
          currentNode.paramChild = new PathNode(":");
          currentNode.paramChild.paramName = name;
        }
        currentNode = currentNode.paramChild;
        i = j;
        continue;
      }

      // Handle Wildcard Tokens
      if (charCode === 42) {
        // '*'
        if (!currentNode.wildcardChild) {
          currentNode.wildcardChild = new PathNode("*");
        }
        currentNode = currentNode.wildcardChild;
        i = path.length;
        continue;
      }

      // Handle Static Text Segments
      let child = this.findStaticChild(currentNode, charCode);

      if (!child) {
        let j = i;
        while (
          j < path.length &&
          path.charCodeAt(j) !== 58 &&
          path.charCodeAt(j) !== 42
        ) {
          j++;
        }
        const sliceStr = path.slice(i, j);
        const newNode = new PathNode(sliceStr);
        newNode.sibling = currentNode.staticChild;
        currentNode.staticChild = newNode;
        currentNode = newNode;
        i = j;
        continue;
      }

      // Radix Prefix Splitting Logic
      let common = 0;
      const maxLimit = Math.min(path.length - i, child.prefix.length);
      while (
        common < maxLimit &&
        path.charCodeAt(i + common) === child.prefix.charCodeAt(common)
      ) {
        if (
          path.charCodeAt(i + common) === 58 ||
          path.charCodeAt(i + common) === 42
        ) {
          break;
        }
        common++;
      }

      if (common < child.prefix.length) {
        const commonPrefix = child.prefix.slice(0, common);
        const splitNode = new PathNode(commonPrefix);

        this.replaceStaticChild(currentNode, charCode, splitNode);

        child.prefix = child.prefix.slice(common);
        child.charCode = child.prefix.charCodeAt(0);
        splitNode.staticChild = child;
        child.sibling = null;

        currentNode = splitNode;
      } else {
        currentNode = child;
      }
      i += common;
    }

    routeData.methodStroage = currentNode.methods;
    routeData.setFingerprint = (fingerprint: number) => {
      routeData.lastFingerprint = fingerprint;
      routeData.methodStroage.set(method, routeData);
    };
    routeData.setDeOpt = () => {
      routeData.disableOpt = true;
      routeData.methodStroage.set(method, routeData);
    };
    currentNode.methods.set(method, routeData);
  }

  private findStaticChild(parent: PathNode, charCode: number) {
    let child = parent.staticChild;
    while (child) {
      if (child.charCode === charCode) return child;
      child = child.sibling;
    }
    return null;
  }

  private replaceStaticChild(
    parent: PathNode,
    oldCharCode: number,
    newNode: PathNode,
  ) {
    let child = parent.staticChild;
    let prev: PathNode | null = null;
    while (child) {
      if (child.charCode === oldCharCode) {
        if (prev) prev.sibling = newNode;
        else parent.staticChild = newNode;
        newNode.sibling = child.sibling;
        return;
      }
      prev = child;
      child = child.sibling;
    }
  }

  public matchPath(
    method: string,
    path: string,
    ctx: RequestContext,
  ): PathData | null {
    if (this.caseInsensitive) {
      path = path.toLowerCase();
    }

    const cached = this.cache.get(method)?.get(path);
    if (cached) {
      return cached;
    }

    let currentNode = this.root;
    let i = 0;
    const len = path.length;
    let hasParams = false;

    const backtrackStack: {
      node: PathNode;
      index: number;
    }[] = [];

    const paramMatches: { name: string; value: string }[] = [];

    while (true) {
      while (i < len) {
        const charCode = path.charCodeAt(i);
        let foundStatic = false;
        if (currentNode.paramChild || currentNode.wildcardChild) {
          backtrackStack.push({
            node: currentNode,
            index: i,
          });
        }

        let child = currentNode.staticChild;
        while (child) {
          if (charCode === child.charCode) {
            const prefix = child.prefix;
            const pLen = prefix.length;
            if (i + pLen <= len) {
              let prefixMatch = true;
              for (let j = 1; j < pLen; j++) {
                if (path.charCodeAt(i + j) !== prefix.charCodeAt(j)) {
                  prefixMatch = false;
                  break;
                }
              }
              if (prefixMatch) {
                i += pLen;
                currentNode = child;
                foundStatic = true;
                break;
              }
            }
          }
          child = child.sibling;
        }

        if (foundStatic) continue;
        if (backtrackStack.length > 0) {
          const fallback = backtrackStack.pop()!;
          currentNode = fallback.node;
          i = fallback.index;
          if (currentNode.paramChild) {
            currentNode = currentNode.paramChild;
            let j = i;
            while (j < len && path.charCodeAt(j) !== 47) j++;

            const extractedValue = path.slice(i, j);
            paramMatches.push({
              name: currentNode.paramName!,
              value: extractedValue,
            });
            hasParams = true;
            i = j;
            continue;
          }

          if (currentNode.wildcardChild) {
            currentNode = currentNode.wildcardChild;
            const extractedValue = path.slice(i);
            paramMatches.push({ name: "*", value: extractedValue });
            hasParams = true;
            i = len;
            break;
          }
        }
        return null;
      }
      const result = currentNode.methods.get(method);
      if (result) {
        for (let k = 0; k < paramMatches.length; k++) {
          ctx.params[paramMatches[k].name] = paramMatches[k].value;
        }

        if (!hasParams && this.cacheSize < this.MAX_CACHE) {
          if (!this.cache.get(method)) {
            this.cache.set(method, new Map());
          }
          this.cache.get(method)?.set(path, result);
          this.cacheSize++;
        }
        return result;
      }
      if (backtrackStack.length > 0) {
        const fallback = backtrackStack.pop()!;
        currentNode = fallback.node;
        i = fallback.index;
        if (currentNode.paramChild) {
          currentNode = currentNode.paramChild;
          let j = i;
          while (j < len && path.charCodeAt(j) !== 47) j++;

          const extractedValue = path.slice(i, j);
          paramMatches.push({
            name: currentNode.paramName!,
            value: extractedValue,
          });
          hasParams = true;
          i = j;
          continue;
        }

        if (currentNode.wildcardChild) {
          currentNode = currentNode.wildcardChild;
          const extractedValue = path.slice(i);
          paramMatches.push({ name: "*", value: extractedValue });
          hasParams = true;
          i = len;
          continue;
        }
      }
      return null;
    }
  }
}

/*
const tree = new RouteTree();
tree.addPath("GET", "/api/user/:id/:info/:length/call", [], () => {});
tree.addPath("GET", "/api/user/list", [], () => {});
console.log(tree.matchPath("GET", "/api/user/123/details/456/call"));
*/
