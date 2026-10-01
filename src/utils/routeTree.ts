/* eslint-disable @typescript-eslint/restrict-template-expressions */
import type { VoltenHandler, PathData, RouteOptions, RoutePriority } from "../core/types.ts";
import { DuplicateRouteError } from "../core/errors.ts";
import { RequestContext } from "./requestCtx.ts";
import { compileMiddlewareChain } from "../core/compose.ts";
import { isEdge } from "./isEdge.ts";

export class MethodStorage {
  public GET: PathData | null = null;
  public POST: PathData | null = null;
  public PUT: PathData | null = null;
  public PATCH: PathData | null = null;
  public DELETE: PathData | null = null;
  public HEAD: PathData | null = null;
  public OPTIONS: PathData | null = null;

  set(method: string, data: PathData): void {
    switch (method) {
      case "GET":
        this.GET = data;
        break;
      case "POST":
        this.POST = data;
        break;
      case "PUT":
        this.PUT = data;
        break;
      case "PATCH":
        this.PATCH = data;
        break;
      case "DELETE":
        this.DELETE = data;
        break;
      case "HEAD":
        this.HEAD = data;
        break;
      case "OPTIONS":
        this.OPTIONS = data;
        break;
    }
  }

  get(method: string): PathData | null {
    switch (method) {
      case "GET":
        return this.GET;
      case "POST":
        return this.POST;
      case "PUT":
        return this.PUT;
      case "PATCH":
        return this.PATCH;
      case "DELETE":
        return this.DELETE;
      case "HEAD":
        return this.HEAD;
      case "OPTIONS":
        return this.OPTIONS;
      default:
        return null;
    }
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
  public routes: string[] = [];
  private staticRoutes: { method: string; path: string; data: PathData }[] = [];
  private caseInsensitive;
  private compiled = false;
  private isMatchPathCompiled = false;
  public matchPath: (method: string, path: string, ctx: RequestContext) => PathData | null;

  constructor(caseInsensitive: boolean) {
    this.caseInsensitive = caseInsensitive;
    this.matchPath = this.defaultMatchPath.bind(this);
    this.clear();
  }

  clear() {
    this.root = new PathNode("");
    this.routes = [];
    this.staticRoutes = [];
    this.compiled = false;
    this.isMatchPathCompiled = false;
    this.matchPath = this.defaultMatchPath.bind(this);
  }

  public checkDuplicate(method: string, path: string) {
    return this.routes.includes(method + path);
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
    if (this.checkDuplicate(method, path)) {
      throw new DuplicateRouteError(method, path);
    }
    this.routes.push(method + path);
    const paramNames: string[] = [];

    const routeData: PathData = {
      method,
      bodyLimit: options.bodyLimit,
      priority: options.priority,
      composeChain,
      disableOpt: false,
      setDeOpt: () => {},
      methodStorage: new MethodStorage(),
      paramNames,
    };

    if (path.indexOf(":") === -1 && path.indexOf("*") === -1) {
      this.staticRoutes.push({ method, path, data: routeData });
    }

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
    while (child !== null && child.charCode !== oldCharCode) {
      prev = child;
      child = child.sibling;
    }
    if (child !== null) {
      if (prev !== null) prev.sibling = newNode;
      else parent.staticChild = newNode;
      newNode.sibling = child.sibling;
    }
  }

  private static readonly SHARED_DUMMY_CTX = { params: {} } as RequestContext;

  public checkMethodAllowed(path: string): string[] {
    const allowedMethods: string[] = [];
    const methodsToCheck = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

    for (const m of methodsToCheck) {
      if (this.matchPath(m, path, RouteTree.SHARED_DUMMY_CTX) !== null) {
        allowedMethods.push(m);
      }
    }
    if (allowedMethods.includes("GET") && !allowedMethods.includes("HEAD")) {
      const getIndex = allowedMethods.indexOf("GET");
      allowedMethods.splice(getIndex + 1, 0, "HEAD");
    }
    if (allowedMethods.length > 0 && !allowedMethods.includes("OPTIONS")) {
      allowedMethods.push("OPTIONS");
    }
    return allowedMethods;
  }

  public getRoutePriority(method: string, path: string): RoutePriority {
    const route = this.matchPath(method, path, RouteTree.SHARED_DUMMY_CTX);
    return route !== null ? route.priority : "normal";
  }

  public defaultMatchPath(method: string, path: string, ctx: RequestContext): PathData | null {
    if (!this.compiled && !isEdge() && ctx.inited) {
      this.createMatchPath();
      if (this.isMatchPathCompiled) {
        return this.matchPath(method, path, ctx);
      }
    }
    const qIdx = path.indexOf("?");
    const pathLen = qIdx === -1 ? path.length : qIdx;
    const originalPath = path;
    const lookupPath = this.caseInsensitive
      ? path.substring(0, pathLen).toLowerCase()
      : path.substring(0, pathLen);

    let currentNode = this.root;
    let i = 0;
    const len = pathLen;

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

            if (j > i) {
              const extractedValue = originalPath.slice(i, j);
              paramMatches.push({
                name: currentNode.paramName ?? "",
                value: extractedValue,
              });

              i = j;
              continue;
            }
          }

          if (currentNode.wildcardChild !== null) {
            currentNode = currentNode.wildcardChild;
            const extractedValue = originalPath.slice(i, len);
            paramMatches.push({ name: "*", value: extractedValue });

            i = len;
            break;
          }
        }
        return null;
      }
      const result =
        currentNode.methods.get(method) ??
        (method === "HEAD" ? currentNode.methods.get("GET") : null);
      if (result !== null) {
        const routeParamNames = result.paramNames ?? [];
        for (let idx = 0; idx < paramMatches.length; idx++) {
          const match = paramMatches[idx];
          if (match === undefined) continue;
          const actualName = routeParamNames[idx] ?? match.name;
          ctx.params[actualName] = match.value;
        }

        return result;
      }
      if (currentNode.wildcardChild !== null) {
        currentNode = currentNode.wildcardChild;
        const extractedValue = originalPath.slice(i, len);
        paramMatches.push({ name: "*", value: extractedValue });
        continue;
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

          if (j > i) {
            const extractedValue = originalPath.slice(i, j);
            paramMatches.push({
              name: currentNode.paramName ?? "",
              value: extractedValue,
            });

            i = j;
            continue;
          }
        }

        if (currentNode.wildcardChild != null) {
          currentNode = currentNode.wildcardChild;
          const extractedValue = originalPath.slice(i, len);
          paramMatches.push({ name: "*", value: extractedValue });

          i = len;
          continue;
        }
      }
      return null;
    }
    return null;
  }
  public createMatchPath(): void {
    if (this.compiled) {
      return;
    }
    this.compiled = true;
    if (isEdge()) {
      return;
    }
    const codeLines: string[] = [];

    // Fast path baseline checks
    codeLines.push(`  let pStart = 0;`);
    codeLines.push(`  let pEnd = 0;`);
    codeLines.push(`  let wStart = 0;`);
    codeLines.push(`  const originalPath = path;`);
    codeLines.push(`  const qIdx = originalPath.indexOf('?');`);
    codeLines.push(`  const pathLen = qIdx === -1 ? originalPath.length : qIdx;`);
    codeLines.push(
      `  const lookupPath = this.caseInsensitive ? originalPath.substring(0, pathLen).toLowerCase() : originalPath;`,
    );

    let staticRouteCounter = 0;
    const routeDataMap: Record<string, PathData> = {};

    // 1. Shared Hidden Class Registry for Route Parameters
    const paramClasses = new Map<string, string>();
    const classDeclarations: string[] = [];
    let classCounter = 0;

    const getParamClass = (names: string[]) => {
      if (names.length === 0) return null;
      const sorted = [...names].sort(); // Alphabetical order
      const sig = sorted.join(",");
      if (!paramClasses.has(sig)) {
        const className = `RouteParams_${classCounter++}`;
        paramClasses.set(sig, className);
        const args = sorted.map((_, i) => `p${i}`).join(", ");
        const assignments = sorted.map((k, i) => `this["${k}"] = p${i};`).join(" ");
        classDeclarations.push(`class ${className} { constructor(${args}) { ${assignments} } }`);
      }
      return paramClasses.get(sig);
    };

    // 2. The Partitioned Static Switch (Double Switch)
    codeLines.push(`  if (qIdx === -1 && !this.caseInsensitive) {`);
    codeLines.push(`    switch (method) {`);

    const methodsToStaticRoutes = new Map<string, typeof this.staticRoutes>();
    for (const sr of this.staticRoutes) {
      let list = methodsToStaticRoutes.get(sr.method);
      if (list === undefined) {
        list = [];
        methodsToStaticRoutes.set(sr.method, list);
      }
      list.push(sr);
    }

    for (const [method, routes] of methodsToStaticRoutes.entries()) {
      codeLines.push(`      case "${method}": {`);
      codeLines.push(`        switch (pathLen) {`);

      const byLength = new Map<number, typeof routes>();
      for (const r of routes) {
        let list = byLength.get(r.path.length);
        if (list === undefined) {
          list = [];
          byLength.set(r.path.length, list);
        }
        list.push(r);
      }

      for (const [len, rts] of byLength.entries()) {
        codeLines.push(`          case ${len}: {`);
        for (const r of rts) {
          const routeKey = `r_${staticRouteCounter++}`;
          routeDataMap[routeKey] = r.data;
          codeLines.push(
            `            if (originalPath === "${r.path}") return externals.${routeKey};`,
          );
        }
        codeLines.push(`            break;`);
        codeLines.push(`          }`);
      }
      codeLines.push(`        }`);
      codeLines.push(`        break;`);
      codeLines.push(`      }`);
    }
    codeLines.push(`    }`);
    codeLines.push(`  }`);

    // Track param index variables to avoid eager slicing
    let paramCounter = 0;

    const compileNode = (
      node: PathNode,
      currentIndent: string,
      indexVar: string,
      activeParams: { name: string; start: string; end: string }[],
    ) => {
      const indent = currentIndent + "  ";

      let child = node.staticChild;
      if (child !== null) {
        codeLines.push(`${indent}if (${indexVar} < pathLen) {`);
        codeLines.push(`${indent}  switch (lookupPath.charCodeAt(${indexVar})) {`);

        while (child !== null) {
          codeLines.push(`${indent}    case ${child.charCode}: {`);
          const pLen = child.prefix.length;
          const nextIndexExpr = `(${indexVar} + ${pLen})`;
          let matchCondition = "true";

          if (pLen > 1) {
            const conditions: string[] = [];
            for (let matchI = 1; matchI < pLen; matchI++) {
              conditions.push(
                `lookupPath.charCodeAt(${indexVar} + ${matchI}) === ${child.prefix.charCodeAt(matchI)}`,
              );
            }
            matchCondition = conditions.join(" && ");
          }

          codeLines.push(`${indent}      if (${nextIndexExpr} <= pathLen && ${matchCondition}) {`);
          compileNode(child, indent + "        ", nextIndexExpr, activeParams);
          codeLines.push(`${indent}      }`);
          codeLines.push(`${indent}      break;`);
          codeLines.push(`${indent}    }`);
          child = child.sibling;
        }
        codeLines.push(`${indent}  }`);
        codeLines.push(`${indent}}`);
      }

      if (node.paramChild !== null) {
        const pChild = node.paramChild;
        const pIdx = paramCounter++;
        const pStartConst = `pStart_${pIdx}`;
        const pEndConst = `pEnd_${pIdx}`;

        codeLines.push(`${indent}pStart = ${indexVar};`);
        codeLines.push(`${indent}pEnd = pStart;`);
        codeLines.push(
          `${indent}while (pEnd < pathLen && lookupPath.charCodeAt(pEnd) !== 47) pEnd++;`,
        );
        codeLines.push(`${indent}if (pEnd > pStart) {`);
        codeLines.push(`${indent}  const ${pStartConst} = pStart;`);
        codeLines.push(`${indent}  const ${pEndConst} = pEnd;`);

        const newParams = [
          ...activeParams,
          { name: pChild.paramName ?? "", start: pStartConst, end: pEndConst },
        ];
        compileNode(pChild, indent + "  ", pEndConst, newParams);
        codeLines.push(`${indent}}`);
      }

      if (node.wildcardChild !== null) {
        const pIdx = paramCounter++;
        const wStartConst = `wStart_${pIdx}`;

        codeLines.push(`${indent}wStart = ${indexVar};`);
        codeLines.push(`${indent}const ${wStartConst} = wStart;`);
        const newParams = [...activeParams, { name: "*", start: wStartConst, end: "pathLen" }];
        emitMethodResolution(node.wildcardChild, indent, newParams);
      }

      codeLines.push(`${indent}if (${indexVar} === pathLen) {`);
      emitMethodResolution(node, indent + "  ", activeParams);
      codeLines.push(`${indent}}`);
    };

    const emitMethodResolution = (
      node: PathNode,
      indent: string,
      activeParams: { name: string; start: string; end: string }[],
    ) => {
      const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
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

          const routeParamNames = data.paramNames ?? [];

          const actualParamsMap = new Map<string, { start: string; end: string }>();
          activeParams.forEach((p, idx) => {
            const paramName = routeParamNames[idx] ?? p.name;
            actualParamsMap.set(paramName, p);
          });

          const uniqueParams = Array.from(actualParamsMap.keys());

          if (uniqueParams.length > 0) {
            const className = getParamClass(uniqueParams) ?? "Object";

            // Build the constructor arguments in alphabetical order!
            const sortedParams = [...uniqueParams].sort();
            const args = sortedParams.map((paramName) => {
              const origParam = actualParamsMap.get(paramName);
              const start = origParam?.start ?? "0";
              const end = origParam?.end ?? "0";
              return `originalPath.slice(${start}, ${end})`;
            });
            codeLines.push(`${indent}    ctx.params = new ${className}(${args.join(", ")});`);
          }

          codeLines.push(`${indent}    return externals.${routeKey};`);
          codeLines.push(`${indent}  }`);
        }
      });

      if (hasMethods as boolean) {
        codeLines.push(`${indent}}`);
      }
    };

    compileNode(this.root, "", "0", []);
    codeLines.push("  return null;");

    try {
      const factoryCode = `${classDeclarations.join("\n")}\nreturn function matchPathCompiled(method, path, ctx) {\n${codeLines.join("\n")}\n};`;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function("externals", factoryCode);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const compiledFn = factory(routeDataMap) as (
        method: string,
        path: string,
        ctx: RequestContext,
      ) => PathData | null;
      this.matchPath = (method: string, path: string, ctx: RequestContext) => {
        const result = compiledFn.call(this, method, path, ctx);
        if (result === null && method === "HEAD") {
          ctx.params = {};
          return compiledFn.call(this, "GET", path, ctx);
        }
        return result;
      };
      this.isMatchPathCompiled = true;
    } catch {
      this.isMatchPathCompiled = false;
    }
  }
}
