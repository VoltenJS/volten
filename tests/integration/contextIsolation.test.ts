import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { App, RequestContext, NodeRequestContext, EdgeRequestContext } from "../../src/index.ts";

test("RequestContext Identity Isolation Adversarial Suite", async (t) => {
  await t.test(
    "1. Normal completion + escaped timer: stale A cannot corrupt active B on recycled storage",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let staleCtxA: RequestContext | null = null;
      let ctxBReference: RequestContext | null = null;

      app.get("/req-a", (ctx) => {
        staleCtxA = ctx;
        ctx.setHeader("x-req", "A");
        ctx.send("Response A");
      });

      app.get("/req-b", async (ctx) => {
        ctxBReference = ctx;
        await new Promise((r) => setTimeout(r, 60));
        ctx.setHeader("x-req", "B");
        ctx.send("Response B");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      // Request A runs and completes normally
      await new Promise<void>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/req-a`, (res) => {
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });

      assert.ok(staleCtxA !== null);
      assert.strictEqual((staleCtxA as RequestContext).isValid, false);

      // Request B starts
      const reqBPromise = new Promise<{
        statusCode: number | undefined;
        body: string;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/req-b`, (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              resolve({
                statusCode: res.statusCode,
                body,
                headers: res.headers,
              });
            });
          })
          .on("error", reject);
      });

      // Escaped timer from Request A attempts to corrupt Request B
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual((staleCtxA as RequestContext).isValid, false);
      assert.notStrictEqual(staleCtxA, ctxBReference);

      // Stale mutations must be inert
      (staleCtxA as RequestContext).setHeader("x-stale-corrupted", "true");
      (staleCtxA as RequestContext).status(418);
      (staleCtxA as RequestContext).send("STALE DATA INJECTION");

      const resB = await reqBPromise;
      assert.strictEqual(resB.statusCode, 200);
      assert.strictEqual(resB.headers["x-stale-corrupted"], undefined);
      assert.strictEqual(resB.headers["x-req"], "B");
      assert.strictEqual(resB.body, "Response B");

      await app.close();
    },
  );

  await t.test(
    "2. Stale reads: expired context never exposes Request B's sensitive data",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let staleCtxA: RequestContext | null = null;

      app.get("/users/:id", (ctx) => {
        staleCtxA = ctx;
        ctx.state["auth"] = "SECRET_TOKEN_A";
        ctx.send("user A");
      });

      app.get("/admin/:id", async (ctx) => {
        ctx.state["auth"] = "SUPER_ADMIN_SECRET_B";
        await new Promise((r) => setTimeout(r, 60));
        ctx.send("admin B");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/users/alice`, (res) => {
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });

      assert.ok(staleCtxA !== null);
      const ctxA = staleCtxA as RequestContext;
      assert.strictEqual(ctxA.isValid, false);

      // Start Request B with sensitive admin data
      const reqBPromise = new Promise<void>((resolve, reject) => {
        http
          .get(
            `http://127.0.0.1:${port}/admin/bob?secret=password123`,
            { headers: { "x-admin-key": "supersecret" } },
            (res) => {
              res.resume();
              res.on("end", resolve);
            },
          )
          .on("error", reject);
      });

      await new Promise((r) => setTimeout(r, 20));

      // Attempt to read Request B's data through staleCtxA handle
      assert.strictEqual(ctxA.isValid, false);
      assert.deepEqual(ctxA.params, Object.create(null));
      assert.deepEqual(ctxA.state, {});
      assert.deepEqual(ctxA.query, {});
      assert.deepEqual(ctxA.headers, {});
      assert.strictEqual(ctxA.path, "");
      assert.strictEqual(ctxA.queryString, "");
      assert.strictEqual(ctxA.res, null);
      assert.throws(() => ctxA.req, /Context expired/);

      await reqBPromise;
      await app.close();
    },
  );

  await t.test(
    "3. Stale response methods: setHeader, removeHeader, status, send, json, text, buffer, flush, cookies",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let staleCtxA: RequestContext | null = null;

      app.get("/first", (ctx) => {
        staleCtxA = ctx;
        ctx.send("first done");
      });

      app.get("/second", async (ctx) => {
        await new Promise((r) => setTimeout(r, 60));
        ctx.setHeader("x-valid", "true");
        ctx.send("second done");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/first`, (res) => {
          res.resume();
          res.on("end", resolve);
        });
      });

      assert.ok(staleCtxA !== null);
      const ctxA = staleCtxA as unknown as RequestContext;

      const reqB = new Promise<{
        statusCode: number | undefined;
        body: string;
        headers: http.IncomingHttpHeaders;
      }>((resolve) => {
        http.get(`http://127.0.0.1:${port}/second`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
        });
      });

      await new Promise((r) => setTimeout(r, 20));

      // Attempt all methods against stale context
      ctxA.status(503);
      ctxA.setHeader("x-poison", "bad");
      ctxA.removeHeader("x-valid");
      ctxA.setCookie("poison_cookie", "1");
      ctxA.clearCookie("poison_cookie");
      await ctxA.flush();
      await ctxA.writeStatic("bad static chunk");
      ctxA.json({ bad: true });
      ctxA.text("bad text");
      ctxA.buffer(Buffer.from("bad buffer"));
      ctxA.send("bad send");

      const resB = await reqB;
      assert.strictEqual(resB.statusCode, 200);
      assert.strictEqual(resB.body, "second done");
      assert.strictEqual(resB.headers["x-valid"], "true");
      assert.strictEqual(resB.headers["x-poison"], undefined);
      assert.strictEqual(resB.headers["set-cookie"], undefined);

      await app.close();
    },
  );

  await t.test(
    "4. Multiple sequential pool reuses: A -> B -> C -> D -> E with RequestPoolSize=1",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      const handles: RequestContext[] = [];

      app.get("/step/:n", async (ctx) => {
        handles.push(ctx);
        const step = ctx.params["n"];
        await new Promise((r) => setTimeout(r, 20));
        ctx.send(`Step ${step}`);
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      const runStep = async (n: number) => {
        return new Promise<string>((resolve) => {
          http.get(`http://127.0.0.1:${port}/step/${n}`, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => resolve(body));
          });
        });
      };

      for (let i = 1; i <= 5; i++) {
        const out = await runStep(i);
        assert.strictEqual(out, `Step ${i}`);
      }

      assert.strictEqual(handles.length, 5);

      // Verify that every single handle has a distinct identity
      for (let i = 0; i < handles.length; i++) {
        for (let j = i + 1; j < handles.length; j++) {
          assert.notStrictEqual(
            handles[i],
            handles[j],
            `Handle ${i} and ${j} must not be the same object instance`,
          );
          assert.notStrictEqual(
            handles[i]!.token,
            handles[j]!.token,
            `Handle ${i} and ${j} must have distinct tokens`,
          );
        }
      }

      // Verify that handles 0..4 are now all invalid
      for (const h of handles) {
        assert.strictEqual(h.isValid, false);
      }

      await app.close();
    },
  );

  await t.test(
    "5. Async unawaited escape: void (async () => { await delay; ctx.send(); })() is inert",
    async () => {
      const app = new App({ RequestPoolSize: 1 });

      app.get("/fire-and-forget", (ctx) => {
        void (async () => {
          await new Promise((r) => setTimeout(r, 40));
          ctx.status(500);
          ctx.setHeader("x-async-leak", "true");
          ctx.send("LEAKED ASYNC");
        })();
        ctx.send("immediate done");
      });

      app.get("/target", async (ctx) => {
        await new Promise((r) => setTimeout(r, 80));
        ctx.send("target ok");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/fire-and-forget`, (res) => {
          res.resume();
          res.on("end", resolve);
        });
      });

      const resB = await new Promise<{
        status: number | undefined;
        body: string;
        headers: http.IncomingHttpHeaders;
      }>((resolve) => {
        http.get(`http://127.0.0.1:${port}/target`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
      });

      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body, "target ok");
      assert.strictEqual(resB.headers["x-async-leak"], undefined);

      await app.close();
    },
  );

  await t.test(
    "6. Raw object boundary: ctx.req throws, ctx.res returns null on expired context",
    () => {
      const storage = new NodeRequestContext();
      storage.reset();
      assert.strictEqual(storage.isValid, false);
      assert.throws(() => storage.req, /Context expired/);
      assert.throws(() => storage.rawReq, /Context expired/);
      assert.strictEqual(storage.res, null);
      assert.strictEqual(storage.rawRes, null);
    },
  );

  await t.test("7. Edge runtime context isolation in createFetch", async () => {
    const app = new App();
    let staleEdgeCtx: EdgeRequestContext | null = null;

    app.get("/edge-a", (ctx) => {
      staleEdgeCtx = ctx as unknown as EdgeRequestContext;
      ctx.setHeader("x-edge", "A");
      ctx.send("Edge A");
    });

    app.get("/edge-b", async (ctx) => {
      await new Promise((r) => setTimeout(r, 40));
      ctx.setHeader("x-edge", "B");
      ctx.send("Edge B");
    });

    const fetch = app.createFetch();

    const resA = await fetch(new Request("http://localhost/edge-a"));
    assert.strictEqual(await resA.text(), "Edge A");

    assert.ok(staleEdgeCtx !== null);
    const edgeCtxA = staleEdgeCtx as EdgeRequestContext;
    assert.strictEqual(edgeCtxA.isValid, false);

    const fetchBPromise = fetch(new Request("http://localhost/edge-b"));

    // Stale attempt while B is running
    edgeCtxA.setHeader("x-edge-poison", "bad");
    edgeCtxA.status(418);
    edgeCtxA.send("Poisoned");

    const resB = await fetchBPromise;
    assert.strictEqual(resB.status, 200);
    assert.strictEqual(resB.headers.get("x-edge"), "B");
    assert.strictEqual(resB.headers.get("x-edge-poison"), null);
    assert.strictEqual(await resB.text(), "Edge B");
  });

  await t.test(
    "8. Exception in handler invalidates context and releases storage cleanly",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let erroredCtx: RequestContext | null = null;

      app.get("/error", (ctx) => {
        erroredCtx = ctx;
        throw new Error("handler failure");
      });

      app.get("/healthy", (ctx) => {
        ctx.send("healthy");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/error`, (res) => {
          res.resume();
          res.on("end", resolve);
        });
      });

      assert.ok(erroredCtx !== null);
      assert.strictEqual((erroredCtx as RequestContext).isValid, false);

      // Verify that next request recovers pooled storage without any issue
      const healthyBody = await new Promise<string>((resolve) => {
        http.get(`http://127.0.0.1:${port}/healthy`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve(body));
        });
      });

      assert.strictEqual(healthyBody, "healthy");

      await app.close();
    },
  );

  await t.test(
    "9. Double release / pool corruption prevention: manual app.resetCtx on already released context does not corrupt pool",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let capturedCtx: NodeRequestContext | null = null;
      let secondCtx: NodeRequestContext | null = null;

      app.get("/normal", (ctx) => {
        capturedCtx = ctx as NodeRequestContext;
        ctx.send("normal done");
      });

      app.get("/second", (ctx2) => {
        secondCtx = ctx2 as NodeRequestContext;
        ctx2.send("second done");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/normal`, (res) => {
          res.resume();
          res.on("end", resolve);
        });
      });

      assert.ok(capturedCtx !== null);
      const ctx = capturedCtx as NodeRequestContext;
      assert.strictEqual(ctx.isValid, false);

      // Attempt duplicate reset on already released context
      app.resetCtx(ctx);
      app.resetCtx(ctx);

      // Pool should still function accurately for subsequent requests
      const secondBody = await new Promise<string>((resolve) => {
        http.get(`http://127.0.0.1:${port}/second`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve(body));
        });
      });

      assert.strictEqual(secondBody, "second done");
      assert.notStrictEqual(ctx, secondCtx);

      await app.close();
    },
  );

  await t.test(
    "10. Client disconnect mid-handler retains detachment and does not recycle storage until settled",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let resumeHandler: (() => void) | null = null;
      let startedHandler: (() => void) | null = null;
      let staleCtx: RequestContext | null = null;

      app.get("/slow", async (ctx) => {
        staleCtx = ctx;
        if (startedHandler) startedHandler();
        await new Promise<void>((resolve) => {
          resumeHandler = resolve;
        });
        ctx.setHeader("x-stale", "corrupted");
        ctx.send("stale response");
      });

      app.get("/fast", (ctx) => {
        ctx.setHeader("x-fast", "ok");
        ctx.send("fast ok");
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      const startedPromise = new Promise<void>((resolve) => {
        startedHandler = resolve;
      });

      const reqA = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/slow",
        method: "GET",
      });
      reqA.on("error", () => {});
      reqA.end();

      await startedPromise;

      // Client A disconnects while handler is suspended
      reqA.destroy();
      await new Promise((r) => setTimeout(r, 25));

      assert.ok(staleCtx !== null);
      assert.strictEqual((staleCtx as RequestContext).disconnected, true);

      // Now issue Request B while Request A is still awaiting
      const reqBFast = new Promise<string>((resolve) => {
        http.get(`http://127.0.0.1:${port}/fast`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve(body));
        });
      });

      const fastRes = await reqBFast;
      assert.strictEqual(fastRes, "fast ok");

      // Now let Request A resume and finish
      if (resumeHandler) (resumeHandler as () => void)();
      await new Promise((r) => setTimeout(r, 25));

      assert.strictEqual((staleCtx as RequestContext).isValid, false);

      await app.close();
    },
  );

  await t.test(
    "11. poolSize=1: aborted suspended request A must never corrupt subsequent request B across multiple iterations",
    async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (err: unknown) => {
        unhandled.push(err);
      };
      process.on("unhandledRejection", onUnhandled);

      try {
        const app = new App({ RequestPoolSize: 1 });

        let resumeRequestA: (() => void) | null = null;
        let requestAStarted: (() => void) | null = null;

        app.get("/test", async (ctx) => {
          const reqId = ctx.headers["x-req-id"];
          if (reqId === "A") {
            if (requestAStarted) requestAStarted();
            await new Promise<void>((resolve) => {
              resumeRequestA = resolve;
            });
            try {
              ctx.status(500);
              ctx.setHeader("x-stale-header", "corrupted");
              if (ctx.res) {
                ctx.res.statusCode = 500;
              }
              ctx.send("STALE DATA FROM A");
            } catch {
              // Inert or throw safely
            }
          } else {
            ctx.status(200);
            ctx.setHeader("x-clean-header", "valid");
            ctx.send("CORRECT DATA FOR B");
          }
        });

        const server = app.listen(0);
        const address = server.address() as { port: number };
        const port = address.port;

        const ITERATIONS = 10;

        for (let i = 0; i < ITERATIONS; i++) {
          const startedPromise = new Promise<void>((resolve) => {
            requestAStarted = resolve;
          });

          const reqA = http.request({
            hostname: "127.0.0.1",
            port,
            path: "/test",
            method: "GET",
            headers: { "x-req-id": "A" },
          });

          reqA.on("error", () => {});
          reqA.end();

          await startedPromise;
          reqA.destroy();

          await new Promise((r) => setTimeout(r, 20));

          const reqBPromise = new Promise<{
            statusCode: number;
            body: string;
            headers: http.IncomingHttpHeaders;
          }>((resolve, reject) => {
            const reqB = http.request(
              {
                hostname: "127.0.0.1",
                port,
                path: "/test",
                method: "GET",
                headers: { "x-req-id": "B" },
              },
              (res) => {
                let data = "";
                res.on("data", (chunk) => {
                  data += chunk;
                });
                res.on("end", () => {
                  resolve({
                    statusCode: res.statusCode ?? 0,
                    body: data,
                    headers: res.headers,
                  });
                });
              },
            );
            reqB.on("error", reject);
            reqB.end();
          });

          if (resumeRequestA) {
            (resumeRequestA as () => void)();
            resumeRequestA = null;
          }

          const resB = await reqBPromise;
          assert.equal(resB.statusCode, 200, `Iteration ${i}: Status should be 200`);
          assert.equal(
            resB.body,
            "CORRECT DATA FOR B",
            `Iteration ${i}: Body must not be corrupted by Request A`,
          );
          assert.equal(
            resB.headers["x-stale-header"],
            undefined,
            `Iteration ${i}: Stale header must not leak into Request B`,
          );
          assert.equal(
            resB.headers["x-clean-header"],
            "valid",
            `Iteration ${i}: Clean header must be present`,
          );
        }

        await new Promise<void>((resolve) => server.close(() => resolve()));
        assert.equal(unhandled.length, 0, "No unhandled rejections should occur");
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  await t.test(
    "12. Pre-captured references (state, params, headers, query, cookies) and double release while B owns recycled storage",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let staleCtxA: NodeRequestContext | null = null;
      let activeCtxB: NodeRequestContext | null = null;
      let stateRefA: Record<string, unknown> | null = null;
      let paramsRefA: Record<string, string> | null = null;
      let headersRefA: Record<string, string | string[] | undefined> | null = null;
      let queryRefA: Record<string, unknown> | null = null;
      let cookiesRefA: Record<string, string> | null = null;

      let bStarted: (() => void) | null = null;
      let resumeB: (() => void) | null = null;

      app.get("/items/:id", async (ctx) => {
        if (ctx.params.id === "item-a") {
          staleCtxA = ctx as NodeRequestContext;
          ctx.state["owner"] = "A";
          stateRefA = ctx.state;
          paramsRefA = ctx.params;
          headersRefA = ctx.headers;
          queryRefA = ctx.query;
          cookiesRefA = ctx.cookies;
          ctx.send("A done");
          return;
        }

        activeCtxB = ctx as NodeRequestContext;
        ctx.state["owner"] = "B";
        // Touch B's lazy properties
        void ctx.params;
        void ctx.headers;
        void ctx.query;
        void ctx.cookies;
        if (bStarted) bStarted();
        await new Promise<void>((resolve) => {
          resumeB = resolve;
        });
        ctx.setHeader("x-owner", String(ctx.state["owner"]));
        ctx.send(`B:${ctx.params.id}:${String(ctx.query["q"])}:${ctx.cookies["sid"]}`);
      });

      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      try {
        await new Promise<void>((resolve, reject) => {
          http
            .get(
              `http://127.0.0.1:${port}/items/item-a?q=alpha`,
              { headers: { Cookie: "sid=cookie-a", "x-custom": "hdr-a" } },
              (res) => {
                res.resume();
                res.on("end", resolve);
              },
            )
            .on("error", reject);
        });

        assert.ok(staleCtxA !== null);
        const ctxA = staleCtxA as NodeRequestContext;
        assert.strictEqual(ctxA.isValid, false);

        const bStartedPromise = new Promise<void>((resolve) => {
          bStarted = resolve;
        });

        const reqBPromise = new Promise<{
          statusCode: number | undefined;
          body: string;
          headers: http.IncomingHttpHeaders;
        }>((resolve, reject) => {
          http
            .get(
              `http://127.0.0.1:${port}/items/item-b?q=beta`,
              { headers: { Cookie: "sid=cookie-b", "x-custom": "hdr-b" } },
              (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () =>
                  resolve({ statusCode: res.statusCode, body, headers: res.headers }),
                );
              },
            )
            .on("error", reject);
        });

        await bStartedPromise;
        assert.ok(activeCtxB !== null);
        const ctxB = activeCtxB as NodeRequestContext;

        // Confirm storage was recycled from A to B
        assert.strictEqual(ctxA._storage, ctxB._storage);
        assert.strictEqual(ctxA.isValid, false);
        assert.strictEqual(ctxB.isValid, true);

        // Double release of A while B actively owns the storage must not affect B
        app.resetCtx(ctxA);
        assert.strictEqual(ctxB.isValid, true);
        assert.strictEqual(ctxB._storage.activeToken, ctxB.token);

        // Stale reads on A (even after query/cookies were cached during A) must return empty objects
        assert.deepEqual(ctxA.state, {});
        assert.deepEqual(ctxA.params, Object.create(null));
        assert.deepEqual(ctxA.headers, {});
        assert.deepEqual(ctxA.query, {});
        assert.deepEqual(ctxA.cookies, {});

        // Pre-captured references from A must never alias B's objects or data
        assert.notStrictEqual(stateRefA, ctxB.state);
        assert.notStrictEqual(paramsRefA, ctxB.params);
        assert.notStrictEqual(headersRefA, ctxB.headers);
        assert.notStrictEqual(queryRefA, ctxB.query);
        assert.notStrictEqual(cookiesRefA, ctxB.cookies);

        assert.strictEqual(stateRefA!["owner"], "A");
        assert.strictEqual(paramsRefA!["id"], "item-a");
        assert.strictEqual(headersRefA!["x-custom"], "hdr-a");
        assert.strictEqual(queryRefA!["q"], "alpha");
        assert.strictEqual(cookiesRefA!["sid"], "cookie-a");

        // Mutating A's pre-captured references must not affect B
        stateRefA!["owner"] = "MUTATED_BY_A";
        paramsRefA!["id"] = "MUTATED_ID";
        queryRefA!["q"] = "MUTATED_Q";

        if (resumeB) (resumeB as () => void)();
        const resB = await reqBPromise;

        assert.strictEqual(resB.statusCode, 200);
        assert.strictEqual(resB.headers["x-owner"], "B");
        assert.strictEqual(resB.body, "B:item-b:beta:cookie-b");
      } finally {
        if (resumeB) (resumeB as () => void)();
        await app.close();
      }
    },
  );

  await t.test(
    "13. Edge pre-captured references and double release while Edge B owns recycled storage",
    async () => {
      const app = new App({ RequestPoolSize: 1 });
      let staleEdgeA: EdgeRequestContext | null = null;
      let activeEdgeB: EdgeRequestContext | null = null;
      let stateRefA: Record<string, unknown> | null = null;
      let paramsRefA: Record<string, string> | null = null;
      let headersRefA: Record<string, string | string[] | undefined> | null = null;
      let queryRefA: Record<string, unknown> | null = null;
      let cookiesRefA: Record<string, string> | null = null;

      let bStarted: (() => void) | null = null;
      let resumeB: (() => void) | null = null;

      app.get("/edge/:id", async (ctx) => {
        if (ctx.params.id === "a") {
          staleEdgeA = ctx as unknown as EdgeRequestContext;
          ctx.state["role"] = "edge-a";
          stateRefA = ctx.state;
          paramsRefA = ctx.params;
          headersRefA = ctx.headers;
          queryRefA = ctx.query;
          cookiesRefA = ctx.cookies;
          ctx.send("edge-a-ok");
          return;
        }

        activeEdgeB = ctx as unknown as EdgeRequestContext;
        ctx.state["role"] = "edge-b";
        void ctx.params;
        void ctx.headers;
        void ctx.query;
        void ctx.cookies;
        if (bStarted) bStarted();
        await new Promise<void>((resolve) => {
          resumeB = resolve;
        });
        ctx.send(`edge-${ctx.params.id}:${String(ctx.state["role"])}:${String(ctx.query["k"])}`);
      });

      const fetch = app.createFetch();

      const resA = await fetch(
        new Request("http://localhost/edge/a?k=v1", {
          headers: { cookie: "token=t1", "x-edge-hdr": "h1" },
        }),
      );
      assert.strictEqual(await resA.text(), "edge-a-ok");

      const edgeA = staleEdgeA!;
      assert.strictEqual(edgeA.isValid, false);

      const bStartedPromise = new Promise<void>((resolve) => {
        bStarted = resolve;
      });

      const resBPromise = fetch(
        new Request("http://localhost/edge/b?k=v2", {
          headers: { cookie: "token=t2", "x-edge-hdr": "h2" },
        }),
      );

      await bStartedPromise;
      const edgeB = activeEdgeB!;

      assert.strictEqual(edgeA._storage, edgeB._storage);
      assert.strictEqual(edgeA.isValid, false);
      assert.strictEqual(edgeB.isValid, true);

      // Double release of edgeA while edgeB owns the recycled storage
      app.resetEdgeCtx(edgeA);
      assert.strictEqual(edgeB.isValid, true);

      // Stale reads on edgeA must return empty objects
      assert.deepEqual(edgeA.state, {});
      assert.deepEqual(edgeA.params, Object.create(null));
      assert.deepEqual(edgeA.headers, {});
      assert.deepEqual(edgeA.query, {});
      assert.deepEqual(edgeA.cookies, {});

      // Pre-captured references from edgeA must not alias edgeB
      assert.notStrictEqual(stateRefA, edgeB.state);
      assert.notStrictEqual(paramsRefA, edgeB.params);
      assert.notStrictEqual(headersRefA, edgeB.headers);
      assert.notStrictEqual(queryRefA, edgeB.query);
      assert.notStrictEqual(cookiesRefA, edgeB.cookies);

      stateRefA!["role"] = "corrupted";
      paramsRefA!["id"] = "corrupted";

      if (resumeB) (resumeB as () => void)();
      const resB = await resBPromise;
      assert.strictEqual(await resB.text(), "edge-b:edge-b:v2");
    },
  );
});

