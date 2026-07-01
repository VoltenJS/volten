import { App } from "../dist/core/server.js";
import path from "path";
import { fileURLToPath } from "node:url";

const volten = new App();
const app = volten.host("**");
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.static(path.join(__dirname, "public"));

app.get("/", (ctx) => {
  ctx.sendFile(path.join(__dirname, "public/index.html"));
});

volten.listen(PORT, () => {
  console.log(`Static File Serving demo running on http://localhost:${PORT}`);
});
