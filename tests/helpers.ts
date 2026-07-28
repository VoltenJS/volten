import http from "node:http";
import type { AddressInfo } from "node:net";
import { App } from "../src/core/server.ts";

interface FetchTestResponse {
  status: number;
  headers: Headers;
  body: string;
  json: <T>() => T;
}
interface HTTPTestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: <T>() => T;
}

export async function requestFetch(
  app: App,
  path: string,
  options: RequestInit = {},
): Promise<FetchTestResponse> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}${path}`;

      try {
        const resOptions = {
          ...options,
          headers: {
            ...options.headers,
            Connection: "close",
          },
        };

        const response = await fetch(url, resOptions);
        const body = await response.text();

        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }

        server.close((err) => {
          if (err) reject(err);

          resolve({
            status: response.status,
            headers: response.headers,
            body,
            json: <T>() => JSON.parse(body) as T,
          });
        });

        server.unref();
      } catch (error) {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => reject(error));
        server.unref();
      }
    });
  });
}

export async function request(
  app: App,
  path: string,
  options: http.RequestOptions & { body?: string } = {},
): Promise<HTTPTestResponse> {
  return new Promise((resolve, reject) => {
    // 1. Start the ephemeral test server
    const server = app.listen(0, () => {
      const address = server.address() as AddressInfo;

      // 2. Separate paths and query strings if an absolute URL was passed
      let targetPath = path;
      let targetHost;

      if (path.startsWith("http://") || path.startsWith("https://")) {
        try {
          const parsedUrl = new URL(path);
          targetPath = parsedUrl.pathname + parsedUrl.search;
          targetHost = parsedUrl.host; // e.g., "fallback-domain.com"
        } catch (e) {
          server.close();
          return reject(e);
        }
      }

      // 3. Merge headers cleanly (ensuring user custom overrides take priority)
      const userHeaders = options.headers || {};
      const mixedHeaders = {
        Connection: "close",
        ...userHeaders,
      };

      // 4. Configure strict HTTP wire options
      const reqOptions: http.RequestOptions = {
        method: options.method || "GET",
        hostname: "127.0.0.1", // Always connect to the local socket
        port: address.port, // Target our dynamic test server port
        path: targetPath,
        headers: mixedHeaders,
        agent: false, // Disable connection pooling to prevent dangling sockets
      };
      /*console.log(
        `${reqOptions.method} ${reqOptions.hostname}:${reqOptions.port}${reqOptions.path}`,
      );*/

      // 5. Execute the low-level HTTP request
      const req = http.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");

          // Clean up connections and close server instantly
          if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
          }

          server.close((err) => {
            if (err) return reject(err);

            resolve({
              status: res.statusCode || 200,
              headers: res.headers,
              body,
              json: <T>() => JSON.parse(body) as T,
            });
          });

          server.unref();
        });
      });

      req.on("error", (error) => {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => reject(error));
        server.unref();
      });

      // 6. Write request payloads down the pipe if provided
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  });
}
