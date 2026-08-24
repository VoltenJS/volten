import { App } from "./core/server.ts";
const app = new App();
const PORT = process.env["PORT"] ?? 3000;

app.get("/", (ctx) => {
  ctx.send("Hello World!");
});

app.get("/user/:id", (ctx) => {
  const userId = ctx.params["id"];
  ctx.json({ userId });
});

app.post("/data", async (ctx) => {
  const data = await ctx.body();
  ctx.json({ received: data });
});

app.listen(PORT, () => {
  console.info(`Server is running on port ${String(PORT)} at: http://localhost:${String(PORT)}`);
});
