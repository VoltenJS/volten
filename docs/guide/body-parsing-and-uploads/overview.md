# Body Parsing & Uploads

Volten features a high-performance, **zero-dependency** body parsing and multipart streaming engine built directly into its core. 

Unlike traditional Node.js frameworks that require third-party middleware packages (such as `body-parser`, `busboy`, or `multer`), Volten provides built-in support for:
- **JSON payloads** (`ctx.body()`)
- **URL-encoded form data** (`application/x-www-form-urlencoded`)
- **Raw text & Webhook payloads** (`ctx.body('text')`)
- **Web Standard Streams** (`ctx.bodyStream`)
- **Streaming multipart file uploads** (`ctx.multipart()`)

---