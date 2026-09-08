import { App } from "./core/server.ts";
import fs from "fs";
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
  const readable = ctx.bodyStream;
  if (!readable) {
    ctx.status(400).text("Bad Request");
    return;
  }
  const writable = fs.createWriteStream("test.mp4");
  readable.pipe(writable);
});

app.listen(PORT, () => {
  console.info(`Server is running on port ${String(PORT)} at: http://localhost:${String(PORT)}`);
});
