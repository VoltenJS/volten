/* eslint-disable @typescript-eslint/restrict-template-expressions */
import type { VoltenHandler, PathData, RouteOptions } from "../core/types.ts";
import { DuplicateRouteError } from "../core/errors.ts";
import { RequestContext } from "./requestCtx.ts";
import { compileMiddlewareChain } from "../core/compose.ts";

export class MethodStorage {
  public GET: PathData | null = null;
  public POST: PathData | null = null;
  public PUT: PathData | null = null;
  public PATCH: PathData | null = null;
  public DELETE: PathData | null = null;

  set(method: string, data: PathData) {
    const m = method.toUpperCase();
    if (m === "GET") this.GET = data;
    else if (m === "POST") this.POST = data;
    else if (m === "PUT") this.PUT = data;
    else if (m === "PATCH") this.PATCH = data;
    else if (m === "DELETE") this.DELETE = data;
  }

  get(method: string): PathData | null {
    return (this as unknown as Record<string, PathData>)[method] ?? null;
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
  public prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.charCode = prefix.length > 0 ? prefix.charCodeAt(0) : -1;
  }
}

export class RouteTree {
  private root: PathNode = new PathNode("");
  private routes: string[] = [];
  private cache: Map<string, Map<string, PathData>> = new Map();
  private cacheSize = 0;
  private caseInsensitive;
  // To-Do: make this more customizable by dev
  private readonly MAX_CACHE = 10000;

  constructor(caseInsensitive: boolean) {
    this.caseInsensitive = caseInsensitive;
    this.clear();
  }

  clear() {
    this.root = new PathNode("");
    this.cache.clear();
    this.cacheSize = 0;
  }

  public checkDuplicate(method: string, path: string) {
    const match = this.matchPath(method, path, { params: {} } as RequestContext);
    const result = match !== null && this.routes.includes(method + path);
    return result;
  }

  public addPath(
    method: string,
    path: string,
    routeHandlers: VoltenHandler[],
    options: Required<RouteOptions>,
  ) {
    const originalPath = path;
    const composeChain = compileMiddlewareChain(routeHandlers);
    if (this.caseInsensitive) {
      path = path.toLowerCase();
    }
    this.routes.push(path);

    if (this.checkDuplicate(method, path)) {
      throw new DuplicateRouteError(method, path);
    }
    const paramNames: string[] = [];

    const routeData: PathData = {
      method,
      bodyLimit: options.bodyLimit,
      composeChain,
      disableOpt: false,
      setDeOpt: () => {},
      methodStorage: new MethodStorage(),
      paramNames,
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
        paramNames.push(name);

        if (currentNode.paramChild === null) {
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
        paramNames.push("*");
        if (currentNode.wildcardChild === null) {
          currentNode.wildcardChild = new PathNode("*");
        }
        currentNode = currentNode.wildcardChild;
        i = path.length;
        continue;
      }

      // Handle Static Text Segments
      const child = this.findStaticChild(currentNode, charCode);

      if (child === null) {
        let j = i;
        while (j < path.length && path.charCodeAt(j) !== 58 && path.charCodeAt(j) !== 42) {
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
      while (common < maxLimit && path.charCodeAt(i + common) === child.prefix.charCodeAt(common)) {
        if (path.charCodeAt(i + common) === 58 || path.charCodeAt(i + common) === 42) {
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

    routeData.methodStorage = currentNode.methods;
    routeData.setDeOpt = () => {
      routeData.disableOpt = true;
      routeData.methodStorage.set(method, routeData);
    };
    currentNode.methods.set(method, routeData);
  }

  private findStaticChild(parent: PathNode, charCode: number) {
    let child = parent.staticChild;
    while (child !== null) {
      if (child.charCode === charCode) return child;
      child = child.sibling;
    }
    return null;
  }

  private replaceStaticChild(parent: PathNode, oldCharCode: number, newNode: PathNode) {
    let child = parent.staticChild;
    let prev: PathNode | null = null;
    while (child !== null) {
      if (child.charCode === oldCharCode) {
        if (prev !== null) prev.sibling = newNode;
        else parent.staticChild = newNode;
        newNode.sibling = child.sibling;
        return;
      }
      prev = child;
      child = child.sibling;
    }
  }

  public checkMethodAllowed(path: string): string[] {
    const allowedMethods: string[] = [];
    const methodsToCheck = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    for (const m of methodsToCheck) {
      if (this.matchPath(m, path, { params: {} } as RequestContext) !== null) {
        allowedMethods.push(m);
      }
    }
    return allowedMethods;
  }

  public matchPath(method: string, path: string, ctx: RequestContext): PathData | null {
    if (ctx.inited) {
      this.createMatchPath();
      return this.matchPath(method, path, ctx);
    }
    const originalPath = path;
    const lookupPath = this.caseInsensitive ? path.toLowerCase() : path;

    const cached = this.cache.get(method)?.get(lookupPath);
    if (cached !== undefined) {
      return cached;
    }

    let currentNode = this.root;
    let i = 0;
    const len = lookupPath.length;
    let hasParams = false;

    const backtrackStack: {
      node: PathNode;
      index: number;
      paramLength: number;
    }[] = [];

    const paramMatches: { name: string; value: string }[] = [];

    for (;;) {
      while (i < len) {
        const charCode = lookupPath.charCodeAt(i);
        let foundStatic = false;
        if (currentNode.paramChild !== null || currentNode.wildcardChild !== null) {
          backtrackStack.push({
            node: currentNode,
            index: i,
            paramLength: paramMatches.length,
          });
        }

        let child = currentNode.staticChild;
        while (child !== null) {
          if (charCode === child.charCode) {
            const prefix = child.prefix;
            const pLen = prefix.length;
            if (i + pLen <= len) {
              let prefixMatch = true;
              for (let j = 1; j < pLen; j++) {
                if (lookupPath.charCodeAt(i + j) !== prefix.charCodeAt(j)) {
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
          const fallback = backtrackStack.pop();
          if (fallback == null) break;
          currentNode = fallback.node;
          i = fallback.index;
          paramMatches.length = fallback.paramLength;
          if (currentNode.paramChild !== null) {
            currentNode = currentNode.paramChild;
            let j = i;
            while (j < len && lookupPath.charCodeAt(j) !== 47) j++;

            const extractedValue = originalPath.slice(i, j);
            paramMatches.push({
              name: currentNode.paramName ?? "",
              value: extractedValue,
            });
            hasParams = true;
            i = j;
            continue;
          }

          if (currentNode.wildcardChild !== null) {
            currentNode = currentNode.wildcardChild;
            const extractedValue = originalPath.slice(i);
            paramMatches.push({ name: "*", value: extractedValue });
            hasParams = true;
            // eslint-disable-next-line no-useless-assignment
            i = len;
            break;
          }
        }
        return null;
      }
      const result = currentNode.methods.get(method);
      if (result !== null) {
        const routeParamNames = result.paramNames ?? [];
        for (let idx = 0; idx < paramMatches.length; idx++) {
          const match = paramMatches[idx];
          if (match === undefined) continue;
          const actualName = routeParamNames[idx] ?? match.name;
          ctx.params[actualName] = match.value;
        }

        if (!hasParams && this.cacheSize < this.MAX_CACHE) {
          if (this.cache.get(method) === undefined) {
            this.cache.set(method, new Map());
          }
          (this.cache.get(method) as Map<string, PathData>).set(lookupPath, result);
          this.cacheSize++;
        }
        return result;
      }
      if (backtrackStack.length > 0) {
        const fallback = backtrackStack.pop();
        if (fallback === undefined) break;
        currentNode = fallback.node;
        i = fallback.index;
        paramMatches.length = fallback.paramLength;
        if (currentNode.paramChild != null) {
          currentNode = currentNode.paramChild;
          let j = i;
          while (j < len && lookupPath.charCodeAt(j) !== 47) j++;

          const extractedValue = originalPath.slice(i, j);
          paramMatches.push({
            name: currentNode.paramName ?? "",
            value: extractedValue,
          });
          hasParams = true;
          i = j;
          continue;
        }

        if (currentNode.wildcardChild != null) {
          currentNode = currentNode.wildcardChild;
          const extractedValue = originalPath.slice(i);
          paramMatches.push({ name: "*", value: extractedValue });
          hasParams = true;
          i = len;
          continue;
        }
      }
      return null;
    }
    return null;
  }
  public createMatchPath(): void {
    const codeLines: string[] = [];

    // Fast path baseline checks
    codeLines.push(`  const originalPath = path;`);
    codeLines.push(`  if (this.caseInsensitive) path = path.toLowerCase();`);
    codeLines.push(`  const cached = this.cache.get(method)?.get(path);`);
    codeLines.push(`  if (cached) return cached;`);
    codeLines.push(`  const len = path.length;`);

    let staticRouteCounter = 0;
    const routeDataMap: Record<string, PathData> = {};

    // Track param index variables to avoid eager slicing
    let paramCounter = 0;

    const compileNode = (
      node: PathNode,
      currentIndent: string,
      indexVar: string,
      activeParams: { name: string; start: string; end: string }[],
    ) => {
      const indent = currentIndent + "  ";

      // 1. Static Child Matching
      let child = node.staticChild;
      if (child !== null) {
        codeLines.push(`${indent}if (${indexVar} < len) {`);
        codeLines.push(`${indent}  switch (path.charCodeAt(${indexVar})) {`);

        while (child !== null) {
          codeLines.push(`${indent}    case ${child.charCode}: {`);

          const pLen = child.prefix.length;
          const nextIndexExpr = `(${indexVar} + ${pLen})`;
          let matchCondition = "true";

          if (pLen > 1) {
            const conditions: string[] = [];
            for (let matchI = 1; matchI < pLen; matchI++) {
              conditions.push(
                `path.charCodeAt(${indexVar} + ${matchI}) === ${child.prefix.charCodeAt(matchI)}`,
              );
            }
            matchCondition = conditions.join(" && ");
          }

          codeLines.push(`${indent}      if (${nextIndexExpr} <= len && ${matchCondition}) {`);
          compileNode(child, indent + "        ", nextIndexExpr, activeParams);
          codeLines.push(`${indent}      }`);
          codeLines.push(`${indent}      break;`);
          codeLines.push(`${indent}    }`);
          child = child.sibling;
        }
        codeLines.push(`${indent}  }`);
        codeLines.push(`${indent}}`);
      }

      // 2. Parameter Node Matching (e.g., :param)
      if (node.paramChild !== null) {
        const pChild = node.paramChild;
        const pIdx = paramCounter++;
        const pStart = `pStart_${pIdx}`;
        const pEnd = `pEnd_${pIdx}`;

        codeLines.push(`${indent}let ${pStart} = ${indexVar};`);
        codeLines.push(`let ${pEnd} = ${pStart};`);
        codeLines.push(`while (${pEnd} < len && path.charCodeAt(${pEnd}) !== 47) ${pEnd}++;`);
        codeLines.push(`if (${pEnd} > ${pStart}) {`);

        const newParams = [...activeParams, { name: pChild.paramName, start: pStart, end: pEnd }];

        // @ts-expect-error - paramName is guaranteed to be non-null here
        compileNode(pChild, indent + "  ", pEnd, newParams);
        codeLines.push(`${indent}}`);
      }

      // 3. Wildcard Node Matching (e.g., *)
      if (node.wildcardChild !== null) {
        const pIdx = paramCounter++;
        const wStart = `wStart_${pIdx}`;

        codeLines.push(`${indent}let ${wStart} = ${indexVar};`);

        const newParams = [...activeParams, { name: "*", start: wStart, end: "len" }];
        emitMethodResolution(node.wildcardChild, indent, newParams);
      }

      // 4. Leaf Node Endpoint Resolution
      codeLines.push(`${indent}if (${indexVar} === len) {`);
      emitMethodResolution(node, indent + "  ", activeParams);
      codeLines.push(`${indent}}`);
    };

    const emitMethodResolution = (
      node: PathNode,
      indent: string,
      activeParams: { name: string; start: string; end: string }[],
    ) => {
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      let hasMethods: boolean = false;

      methods.forEach((m) => {
        const data = node.methods.get(m);
        if (data !== null) {
          if (!hasMethods) {
            codeLines.push(`${indent}switch (method) {`);
            hasMethods = true;
          }
          const routeKey = `r_${staticRouteCounter++}`;
          routeDataMap[routeKey] = data;

          codeLines.push(`${indent}  case "${m}": {`);

          // Lazy String Allocation: Slice only upon a guaranteed route match
          activeParams.forEach((p, idx) => {
            const routeParamNames = data.paramNames ?? [];
            const actualName = routeParamNames[idx] ?? p.name;
            codeLines.push(
              `${indent}    ctx.params["${actualName}"] = originalPath.slice(${p.start}, ${p.end});`,
            );
          });

          codeLines.push(`${indent}    return externals.${routeKey};`);
          codeLines.push(`${indent}  }`);
        }
      });

      if (hasMethods as boolean) {
        codeLines.push(`${indent}}`);
      }
    };

    // Compile starting from the root
    compileNode(this.root, "", "0", []);
    codeLines.push("  return null;");

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "externals",
      `return function matchPathCompiled(method, path, ctx) {\n${codeLines.join("\n")}\n};`,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const compiledFn = factory(routeDataMap) as (
      method: string,
      path: string,
      ctx: RequestContext,
    ) => PathData | null;
    this.matchPath = (method: string, path: string, ctx: RequestContext) => {
      const result = compiledFn.call(this, method, path, ctx);

      if (
        result !== null &&
        Object.keys(ctx.params).length === 0 &&
        this.cacheSize < this.MAX_CACHE
      ) {
        let methodData = this.cache.get(method);
        if (methodData === undefined) {
          methodData = new Map();
          this.cache.set(method, methodData);
        }
        methodData.set(path, result);
        this.cacheSize++;
      }
      return result;
    };
  }
}
