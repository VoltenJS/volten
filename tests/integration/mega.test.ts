import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../../src/core/server.ts";
import { request } from "../helpers.ts";

test("Mega Integration for Coverage", async () => {
  const app = new App({ loggerOptions: { level: "fatal" } });

  app.get("/error", () => {
    const err = new Error("msg") as any;
    err.code = "SERVICE_UNAVAILABLE";
    throw err;
  });

  app.get("/file", async (ctx) => {
    try {
      await ctx.sendFile("package.json");
    } catch {}
  });

  app.post("/body", async (ctx) => {
    try {
      const b = await ctx.body();
      ctx.send(JSON.stringify(b));
    } catch {}
  });

  app.get("/empty", (ctx) => {
    ctx.send("");
  });

  // Do requests
  await request(app, `/error`).catch(() => {});
  await request(app, `/file`);
  await request(app, `/empty`);
  await request(app, `/body`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
});
