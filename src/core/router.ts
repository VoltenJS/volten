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
    const rawOptions = isOptions ? { ...arg2 } : {};

    const options: Required<RouteOptions> = {
      bodyLimit: rawOptions.bodyLimit ?? null,
      priority: rawOptions.priority ?? "normal",
    };

    const routeHandlers = isOptions ? handlers : [arg2, ...handlers];

    return { options, routeHandlers };
  }

  /**
   * Registers one or more middleware handlers or mounts a sub-router.
   *
   * Can be used to apply global middleware to the router, or mount sub-routers with a prefix path.
   *
   * @param {...VoltenHandler[]} fns - Middleware functions to register.
   * @returns {this} The router instance for chaining.
   *
   * @example
   * router.use(loggerMiddleware);
   */
  use(...fns: VoltenHandler[]): this;
  /**
   * Mounts a sub-router at the specified prefix path.
   *
   * @param {string} path - The prefix path for the sub-router.
   * @param {Router} router - The sub-router instance to mount.
   * @returns {this} The router instance for chaining.
   *
   * @example
   * router.use('/api', apiRouter);
   */
  use(path: string, router: Router): this;
  /**
   * Mounts a sub-router instance directly.
   *
   * @param {Router} router - The sub-router instance to mount.
   * @returns {this} The router instance for chaining.
   *
   * @example
   * router.use(apiRouter);
   */
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

  /**
   * Registers a GET route handler for the specified path.
   *
   * @param {string} path - The route path pattern (supports parameters e.g., `/user/:id`).
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   *
   * @example
   * router.get('/users', async (ctx) => {
   *   return ctx.json({ users: [] });
   * });
   */
  get<P extends string>(path: P, ...handlers: VoltenHandler<P>[]): void;
  /**
   * Registers a GET route with custom route options and handlers.
   *
   * @param {string} path - The route path pattern.
   * @param {RouteOptions} options - Route options config (e.g. body limit).
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   */
  get<P extends string>(path: P, options: RouteOptions, ...handlers: VoltenHandler<P>[]): void;
  get<P extends string>(
    path: P,
    arg2: RouteOptions | VoltenHandler<P>,
    ...handlers: VoltenHandler<P>[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2 as RouteOptions | VoltenHandler,
      ...(handlers as unknown as VoltenHandler[]),
    );
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "GET", path, options, handlers: handlersWithMiddleware });
  }

  /**
   * Registers a POST route handler for the specified path.
   *
   * @param {string} path - The route path pattern.
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   *
   * @example
   * router.post('/users', async (ctx) => {
   *   const body = await ctx.body();
   *   return ctx.status(201).json({ created: true });
   * });
   */
  post<P extends string>(path: P, ...handlers: VoltenHandler<P>[]): void;
  /**
   * Registers a POST route with custom route options and handlers.
   *
   * @param {string} path - The route path pattern.
   * @param {RouteOptions} options - Route options config (e.g. body limit).
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   */
  post<P extends string>(path: P, options: RouteOptions, ...handlers: VoltenHandler<P>[]): void;
  post<P extends string>(
    path: P,
    arg2: RouteOptions | VoltenHandler<P>,
    ...handlers: VoltenHandler<P>[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2 as RouteOptions | VoltenHandler,
      ...(handlers as unknown as VoltenHandler[]),
    );
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "POST", path, options, handlers: handlersWithMiddleware });
  }

  /**
   * Registers a PATCH route handler for the specified path.
   *
   * @param {string} path - The route path pattern.
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   *
   * @example
   * router.patch('/users/:id', async (ctx) => {
   *   return ctx.json({ updated: true });
   * });
   */
  patch<P extends string>(path: P, ...handlers: VoltenHandler<P>[]): void;
  /**
   * Registers a PATCH route with custom route options and handlers.
   *
   * @param {string} path - The route path pattern.
   * @param {RouteOptions} options - Route options config (e.g. body limit).
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   */
  patch<P extends string>(path: P, options: RouteOptions, ...handlers: VoltenHandler<P>[]): void;
  patch<P extends string>(
    path: P,
    arg2: RouteOptions | VoltenHandler<P>,
    ...handlers: VoltenHandler<P>[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2 as RouteOptions | VoltenHandler,
      ...(handlers as unknown as VoltenHandler[]),
    );
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "PATCH", path, options, handlers: handlersWithMiddleware });
  }

  /**
   * Registers a PUT route handler for the specified path.
   *
   * @param {string} path - The route path pattern.
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   *
   * @example
   * router.put('/users/:id', async (ctx) => {
   *   return ctx.json({ replaced: true });
   * });
   */
  put<P extends string>(path: P, ...handlers: VoltenHandler<P>[]): void;
  /**
   * Registers a PUT route with custom route options and handlers.
   *
   * @param {string} path - The route path pattern.
   * @param {RouteOptions} options - Route options config (e.g. body limit).
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   */
  put<P extends string>(path: P, options: RouteOptions, ...handlers: VoltenHandler<P>[]): void;
  put<P extends string>(
    path: P,
    arg2: RouteOptions | VoltenHandler<P>,
    ...handlers: VoltenHandler<P>[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2 as RouteOptions | VoltenHandler,
      ...(handlers as unknown as VoltenHandler[]),
    );
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "PUT", path, options, handlers: handlersWithMiddleware });
  }

  /**
   * Registers a DELETE route handler for the specified path.
   *
   * @param {string} path - The route path pattern.
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   *
   * @example
   * router.delete('/users/:id', async (ctx) => {
   *   return ctx.json({ deleted: true });
   * });
   */
  delete<P extends string>(path: P, ...handlers: VoltenHandler<P>[]): void;
  /**
   * Registers a DELETE route with custom route options and handlers.
   *
   * @param {string} path - The route path pattern.
   * @param {RouteOptions} options - Route options config.
   * @param {...VoltenHandler[]} handlers - One or more handler functions.
   */
  delete<P extends string>(path: P, options: RouteOptions, ...handlers: VoltenHandler<P>[]): void;
  delete<P extends string>(
    path: P,
    arg2: RouteOptions | VoltenHandler<P>,
    ...handlers: VoltenHandler<P>[]
  ): void {
    const { options, routeHandlers } = this.identifyParamType(
      arg2 as RouteOptions | VoltenHandler,
      ...(handlers as unknown as VoltenHandler[]),
    );
    const handlersWithMiddleware = [...this.middleware, ...routeHandlers];
    this.routes.push({ method: "DELETE", path, options, handlers: handlersWithMiddleware });
  }

  /**
   * Registers all routes and sub-routers defined on this Router instance with the main Volten App.
   *
   * @param {App<string>} app - The main Volten application instance.
   * @param {string} [prefix=""] - A path prefix to prepend to all route paths.
   * @param {VoltenHandler[]} [parentMiddleware=[]] - Middleware inherited from parent routers.
   *
   * @example
   * router.register(app, '/api');
   */
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
