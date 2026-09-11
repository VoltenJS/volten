# Multipart Form Data & File Uploads

Handling `multipart/form-data` uploads safely is a common challenge in Node.js. Many libraries buffer all files in RAM or write everything to temporary disk storage before your route handler runs.

Volten prevents memory exhaustion by requiring that multipart uploads be consumed via `ctx.multipart()`:

```typescript
app.post('/upload', async (ctx) => {
  // Ensure the request is multipart
  if (!ctx.isMultipart) {
    return ctx.status(400).send('Expected multipart/form-data');
  }

  const uploadedFiles: string[] = [];

  // Stream each part sequentially
  for await (const part of ctx.multipart()) {
    if (part.isFile) {
      console.log(`Receiving file: ${part.filename} (${part.contentType})`);
      
      // Save directly to disk without loading into RAM
      const savePath = `./uploads/${Date.now()}-${part.filename}`;
      await part.save(savePath);

      uploadedFiles.push(savePath);
    } else {
      console.log(`Form field [${part.name}]: ${part.value}`);
    }
  }

  return ctx.json({ success: true, files: uploadedFiles });
});
```

::: warning parseBody is Protected
If you attempt to call `ctx.body()` on a `multipart/form-data` request, Volten throws an explicit error:
```
Volten: Use ctx.multipart() to handle multipart/form-data streams. parseBody() is restricted to text/json inputs to prevent memory exhaustion.
```
:::

### Multipart Part Properties & Methods

The async generator `ctx.multipart()` yields `MultipartPart` objects. Inspect `part.isFile` to determine whether it is a file or a plain text field:

#### When `part.isFile === true`

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `part.isFile` | `true` | Indicates this part is an uploaded file. |
| `part.name` | `string` | The form field name (e.g. `'avatar'`). |
| `part.filename` | `string` | The sanitized basename of the uploaded file. |
| `part.contentType` | `string` | The MIME type provided by the client (e.g. `'image/png'`). |
| `part.stream` | `Readable` | A Node.js `Readable` stream of the file contents. |
| `part.save(targetPath)` | `(path: string) => Promise<void>` | Pipes the file stream directly to disk, creating destination folders recursively. |
| `part.buffer()` | `() => Promise<Buffer>` | Buffers the entire file in memory and returns a `Buffer`. |
| `part.text()` | `() => Promise<string>` | Reads the file as a UTF-8 string. |

#### When `part.isFile === false`

| Property | Type | Description |
| :--- | :--- | :--- |
| `part.isFile` | `false` | Indicates this part is a standard text field. |
| `part.name` | `string` | The form field name. |
| `part.value` | `string` | The string value of the field. |

### In-Memory File Buffering Example

If you need to process file buffers directly (for example, uploading to AWS S3 or image resizing):

```typescript
app.post('/avatar', async (ctx) => {
  for await (const part of ctx.multipart()) {
    if (part.isFile && part.name === 'avatar') {
      const fileBuffer = await part.buffer();
      
      // Upload buffer directly to cloud storage
      await uploadToS3(part.filename, fileBuffer, part.contentType);
      return ctx.json({ uploaded: true });
    }
  }

  return ctx.status(400).json({ error: 'No avatar uploaded' });
});
```

---