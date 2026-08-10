import type { VoltenHandler, RouteOptions } from "./types.ts";
import type { App } from "./server.ts";

export class Router {
  protected middleware: VoltenHandler[] = [];
  protected routes: {
    method: string;
    path: string;
    options: Required<RouteOptions>;
    handlers: VoltenHandler[];
  }[] = [];
  protected subRouters: {
    path: string;
    router: Router;
    parentMiddleware: VoltenHandler[];
  }[] = [];

  private identifyParamType(
    arg2: RouteOptions | VoltenHandler,
    ...handlers: VoltenHandler[]
  ): { options: Required<RouteOptions>; routeHandlers: VoltenHandler[] } {
    const isOptions = typeof arg2 === "object";
    const options = (isOptions ? { ...arg2 } : {}) as Required<RouteOptions>;
    options.bodyLimit = options.bodyLimit ?? null;

    const routeHandlers = isOptions ? handlers : [arg2, ...handlers];

    return { options, routeHandlers };
  }

  use(...fns: VoltenHandler[]): this;
  use(path: string, router: Router): this;
  use(router: Router): this;
  use(...args: unknown[]): this {
    if (args.length === 1 && args[0] instanceof Router) {
      this.subRouters.push({ path: "", router: args[0], parentMiddleware: [...this.middleware] });
      return this;
    }
    if (args.length === 2 && typeof args[0] === "string" && args[1] instanceof Router) {
      this.subRouters.push({
        path: args[0],
        router: args[1],
        parentMiddleware: [...this.middleware],
      });
      return this;
    }
    this.middleware.push(...(args as VoltenHandler[]));
    return this;
  }

  get(path: string, ...handlers: VoltenHandler[]): void;
  get(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  get(path: string, arg2: RouteOptions | VoltenHandler, ...handlers: VoltenHandler[]): void {
    const { options, routeHandlers } = this.identifyParamType(arg2, ...handlers);
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "GET", path, options, handlers: handlersWithMiddleware });
  }

  post(path: string, ...handlers: VoltenHandler[]): void;
  post(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  post(path: string, arg2: RouteOptions | VoltenHandler, ...handlers: VoltenHandler[]): void {
    const { options, routeHandlers } = this.identifyParamType(arg2, ...handlers);
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "POST", path, options, handlers: handlersWithMiddleware });
  }

  patch(path: string, ...handlers: VoltenHandler[]): void;
  patch(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  patch(path: string, arg2: RouteOptions | VoltenHandler, ...handlers: VoltenHandler[]): void {
    const { options, routeHandlers } = this.identifyParamType(arg2, ...handlers);
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "PATCH", path, options, handlers: handlersWithMiddleware });
  }

  put(path: string, ...handlers: VoltenHandler[]): void;
  put(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  put(path: string, arg2: RouteOptions | VoltenHandler, ...handlers: VoltenHandler[]): void {
    const { options, routeHandlers } = this.identifyParamType(arg2, ...handlers);
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "PUT", path, options, handlers: handlersWithMiddleware });
  }

  delete(path: string, ...handlers: VoltenHandler[]): void;
  delete(path: string, options: RouteOptions, ...handlers: VoltenHandler[]): void;
  delete(path: string, arg2: RouteOptions | VoltenHandler, ...handlers: VoltenHandler[]): void {
    const { options, routeHandlers } = this.identifyParamType(arg2, ...handlers);
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "DELETE", path, options, handlers: handlersWithMiddleware });
  }

  register(app: App<string>, prefix: string = "", parentMiddleware: VoltenHandler[] = []) {
    const tree = app.getRouteTree();

    for (const route of this.routes) {
      let fullPath = prefix + route.path;
      if (fullPath !== "/" && fullPath.endsWith("/")) {
        fullPath = fullPath.slice(0, -1);
      }
      if (fullPath === "") fullPath = "/";

      const handlers = parentMiddleware.concat(route.handlers);
      tree.addPath(route.method, fullPath, handlers, route.options);
    }

    for (const sub of this.subRouters) {
      let subPrefix = prefix + sub.path;
      if (subPrefix !== "/" && subPrefix.endsWith("/")) {
        subPrefix = subPrefix.slice(0, -1);
      }
      sub.router.register(app, subPrefix, parentMiddleware.concat(sub.parentMiddleware));
    }
  }
}
