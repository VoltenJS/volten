import { App } from "./core/server.ts";
const app = new App();

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

app.listen(3000, () => {
  console.info("Server is running on port 3000 at: http://localhost:3000");
});
