# Request Body & Streaming

Volten features on-demand body parsing and streaming:

### `await ctx.body(type?: 'json' | 'text')`
Parses the incoming request body on demand. Caches the result on the context so multiple calls return the same data without re-reading the stream:

```typescript
app.post('/api/data', async (ctx) => {
  // Parse as JSON
  const json = await ctx.body();

  // Or parse as raw string
  // const text = await ctx.body('text');

  return ctx.json({ received: json });
});
```

### `ctx.bodyStream`
Exposes the request payload as a standard Web `ReadableStream<Uint8Array>`:

```typescript
import { Writable } from 'stream';
import fs from 'fs';

app.post('/upload-stream', async (ctx) => {
  const fileStream = fs.createWriteStream('./uploads/file.bin');
  
  // Pipe Web ReadableStream to Node WritableStream
  await ctx.bodyStream.pipeTo(Writable.toWeb(fileStream));
  
  return ctx.send('Stream uploaded successfully');
});
```

### `ctx.multipart()`
An asynchronous generator for streaming multipart file uploads without buffering the entire payload into RAM:

```typescript
app.post('/upload', async (ctx) => {
  for await (const part of ctx.multipart()) {
    if (part.isFile) {
      console.log(`Uploading file: ${part.filename}`);
      await part.save(`./uploads/${part.filename}`);
    } else {
      console.log(`Field ${part.name}: ${part.value}`);
    }
  }

  return ctx.json({ success: true });
});
```

For complete details on uploads and parsing, see the [Body Parsing & Uploads Guide](/guide/body-parsing-and-uploads).

---