import { App } from "./core/server.ts";
import { drr, setDRRConfig } from "./tools/drr/index.ts";

export const app = new App({ bodyLimit: 1024 * 1024 * 1024 * 5 });

app.enableDrr({ drr, setDRRConfig }, { outDir: "./crashes" });
const PORT = process.env["PORT"] ?? 3000;

app.get("/", (ctx) => {
  ctx.send("Hello World!");
});

app.get("/user/:id", (ctx) => {
  const userId = ctx.params["id"];
  ctx.json({ userId });
});

app.post("/data", async (ctx) => {
  await ctx.body();
  throw new Error("This is a test error");
});

app.get("/error", () => {
  throw new Error("This is a test error");
});

app.listen(PORT, () => {
  console.info(`Server is running on port ${String(PORT)} at: http://localhost:${String(PORT)}`);
});
