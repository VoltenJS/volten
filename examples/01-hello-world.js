// A minimal "Hello World" example to demonstrate Volten's simplicity and performance.
// For this to work, you must build Volten first and update the import path on the next line.
import { App } from "../dist/index.js";
const app = new App();
app.get("/", (ctx) => ctx.text("Hello world!"));
app.listen(process.env.PORT || 3000);
