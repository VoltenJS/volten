import { App } from "../dist/core/server.js";
import path from "path";
import { fileURLToPath } from "node:url";

const app = new App();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.static(path.join(__dirname, "public"));

app.get("/", (ctx) => {
  ctx.sendFile(path.join(__dirname, "public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Static File Serving demo running on http://localhost:${PORT}`);
});
