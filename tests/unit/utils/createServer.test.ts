import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { createServer } from "../../../src/utils/createServer.ts";

test("createServer: no arguments creates a default HTTP server", () => {
  const server = createServer();
  assert.ok(server instanceof http.Server);
  assert.ok(!(server instanceof https.Server));
});

test("createServer: passing only a request listener creates an HTTP server", () => {
  const listener: http.RequestListener = (_, res) => {
    res.end("hello");
  };
  const server = createServer(listener);
  assert.ok(server instanceof http.Server);
});

test("createServer: options without https config creates an HTTP server", () => {
  const listener: http.RequestListener = (_, res) => {
    res.end("hello");
  };
  const options = {
    keepAlive: true,
  };
  const server = createServer(options, listener);
  assert.ok(server instanceof http.Server);
});

test("createServer: options with https config creates an HTTPS server (mocked)", () => {
  const listener: http.RequestListener = (_, res) => {
    res.end("hello");
  };
  const options = {
    keepAlive: true,
    https: {
      key: "dummy-key",
      cert: "dummy-cert",
    },
  };

  const dummyServer = {} as https.Server;
  const createServerMock = mock.method(https, "createServer", (opt: any, lst: any) => {
    assert.equal(opt.key, "dummy-key");
    assert.equal(opt.cert, "dummy-cert");
    assert.equal(opt.keepAlive, true);
    assert.equal(lst, listener);
    return dummyServer;
  });

  const server = createServer(options, listener);
  assert.equal(server, dummyServer);

  createServerMock.mock.restore();
});
