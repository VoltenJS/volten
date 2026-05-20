// A minimal "Hello World" example to demonstrate Volten's simplicity and performance.
// For this to work, you must build Volten first and update the import path on the next line.
import { App } from "../dist/core/server.js";
const volten = new App();
const app = volten.host("**");
app.get("/", (ctx) => ctx.text("Hello world!"));
volten.listen(3000);
