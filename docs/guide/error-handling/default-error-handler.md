# Default Error Handler

If you do not register a custom error handler, Volten's default error handler responds according to the error type and the client's `Accept` header.

### Content Negotiation

- **JSON Clients**: If the request includes `Accept: application/json`, the response is automatically formatted as JSON:
  ```json
  {
    "error": "Route Not Found",
    "code": 404
  }
  ```
- **Standard Clients**: Otherwise, it sends plain text:
  ```text
  Route Not Found
  ```
- **405 Method Not Allowed**: When the path exists but the HTTP method is not registered, the response includes an RFC `Allow` header listing the methods that are registered for that path (for example `Allow: GET, POST`). The `MethodNotAllowedError` instance also exposes those methods as `allowedMethods` for custom `app.onError` handlers.

### Developer Experience (HTML Stack Traces)

To improve Developer Experience (DevEx), when an unhandled exception occurs (HTTP 500) and `NODE_ENV` is explicitly set to `"development"`, the default error handler will generate a rich, syntax-highlighted HTML error page.

This page beautifully formats the stack trace and highlights the exact file, line, and column where the error originated, making it drastically easier to debug.

If `NODE_ENV` is unset or set to any other environment (such as `"production"`), the HTML page is disabled to prevent leaking sensitive stack traces and internal paths to users, falling back to a generic `500 Internal Server Error` message.

---
