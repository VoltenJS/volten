# Streaming Large Payloads with ctx.bodyStream

For scenarios involving large payloads—such as streaming videos, log forwarding, or proxying requests—reading the entire payload into RAM is impractical.

Volten exposes `ctx.bodyStream`, which returns a Web Standard `ReadableStream<Uint8Array>`:

```typescript
import { App } from 'volten';
import { Writable } from 'node:stream';
import { createWriteStream } from 'node:fs';

const app = new App();

app.post('/upload-raw', async (ctx) => {
  const destination = createWriteStream('./uploads/large-file.bin');
  
  // Pipe Web Standard ReadableStream to Node.js WritableStream
  await ctx.bodyStream.pipeTo(Writable.toWeb(destination));

  return ctx.send('File saved successfully');
});
```

You can also consume chunks iteratively using `for await`:

```typescript
app.post('/process-chunks', async (ctx) => {
  let totalBytes = 0;

  for await (const chunk of ctx.bodyStream) {
    totalBytes += chunk.length;
  }

  return ctx.json({ processedBytes: totalBytes });
});
```

::: warning Memory Protection
If an incoming payload exceeds Node.js's internal string limit (`constants.MAX_STRING_LENGTH`), `ctx.body()` rejects the operation to prevent V8 memory crashes and prompts you to use `ctx.bodyStream`.
:::

---