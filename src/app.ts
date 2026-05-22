import { App } from "./core/server.ts";
const volten = new App();
const app = volten.host("**");

app.get("/", (ctx) => {
  ctx.send("Hello World!");
});

app.get("/user/:id", (ctx) => {
  const userId = ctx.params.id;
  ctx.json({ userId });
});

app.post("/data", async (ctx) => {
  const data = await ctx.body();
  ctx.json({ received: data });
});

volten.listen(3000, () => {
  console.info("Server is running on port 3000 at: http://localhost:3000");
});
