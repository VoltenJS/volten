# File Serving & Downloads (Node.js)

When running on Node.js, `RequestContext` provides optimized static file streaming with automatic MIME detection, caching, and conditional ETags:

### `await ctx.sendFile(filePath, statusCode?, options?)`

Streams a file directly from the filesystem with automatic ETag generation and 304 Not Modified response support:

```typescript
app.get("/assets/logo.png", async (ctx) => {
  return await ctx.sendFile("./public/images/logo.png");
});
```

### `await ctx.download(filePath, fileName, statusCode?, errCallback?)`

Convenience method that streams a file with the `Content-Disposition: attachment; filename=...` header:

```typescript
app.get("/reports/:id/pdf", async (ctx) => {
  return await ctx.download("./reports/annual-2026.pdf", "Financial-Report-2026.pdf");
});
```

---
