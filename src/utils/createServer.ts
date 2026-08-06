import type { VoltenHttpsOptions } from "../core/types.ts";
import http from "node:http";
import https from "node:https";

function createServer(requestListener?: http.RequestListener): http.Server;
function createServer(
  options: http.ServerOptions & { https?: VoltenHttpsOptions },
  requestListener?: http.RequestListener,
): http.Server;
function createServer(
  optionsOrListener?: (http.ServerOptions & { https?: VoltenHttpsOptions }) | http.RequestListener,
  maybeListener?: http.RequestListener,
): http.Server | https.Server {
  if (typeof optionsOrListener === "function") {
    return http.createServer(optionsOrListener);
  }

  if (optionsOrListener !== undefined) {
    const { https: httpsConfig, ...serverOptions } = optionsOrListener;

    if (httpsConfig !== undefined) {
      const httpsOptions: https.ServerOptions = {
        ...serverOptions,
        key: httpsConfig.key,
        cert: httpsConfig.cert,
      };
      return https.createServer(httpsOptions, maybeListener);
    }

    return http.createServer(serverOptions, maybeListener);
  }

  return http.createServer();
}

export { createServer };
