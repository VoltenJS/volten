# Built-in Errors

All framework errors in Volten extend the base class `VoltenError`.

### The `VoltenError` Base Class

`VoltenError` extends the JavaScript native `Error` and attaches structured HTTP metadata:

```typescript
export class VoltenError extends Error {
  public readonly code: string; // e.g. 'ERR_NOT_FOUND'
  public readonly statusCode: number; // e.g. 404

  constructor(code: string, message: string, statusCode: number = 500, options?: ErrorOptions);

  public static from(error: unknown): VoltenError;
  public static isVoltenError(error: unknown): error is VoltenError;
  public toJSON(includeStack?: boolean): { error: object };
}
```

#### Key Utilities

- **`VoltenError.from(err)`**: Converts any unknown value (e.g. a string or a third-party `Error`) into a `VoltenError` while preserving the original stack trace.
- **`VoltenError.isVoltenError(err)`**: A TypeScript type guard to test if an unknown error originates from Volten.
- **`err.toJSON(includeStack?)`**: Formats the error into a structured JSON payload suitable for API responses.

### Built-in Error Reference

| Class Name                     | Status | Code                              | Description                                                                                    |
| :----------------------------- | :----- | :-------------------------------- | :--------------------------------------------------------------------------------------------- |
| `NotFoundError`                | `404`  | `ERR_NOT_FOUND`                   | Thrown when a requested route or static file does not exist.                                   |
| `MethodNotAllowedError`        | `405`  | `ERR_METHOD_NOT_ALLOWED`          | Thrown when the path exists, but the HTTP method is not registered. Contains `allowedMethods`. |
| `PayloadTooLargeError`         | `413`  | `ERR_PAYLOAD_TOO_LARGE`           | Thrown when request body exceeds the configured `bodyLimit`.                                   |
| `BadRequestError`              | `400`  | `ERR_BAD_REQUEST`                 | General bad request / client-side input error.                                                 |
| `BodyReadOnInvalidMethodError` | `400`  | `ERR_BODY_READ_ON_INVALID_METHOD` | Thrown if an attempt is made to read body on invalid methods.                                  |
| `HeadersSentError`             | `500`  | `ERR_HEADERS_SENT`                | Thrown when attempting to modify headers after they have already been flushed to the socket.   |
| `ResponseSentError`            | `500`  | `ERR_RESPONSE_SENT`               | Thrown when attempting to send a body after the response has finalized.                        |
| `InvalidNextCallError`         | `500`  | `ERR_INVALID_NEXT_CALL`           | Thrown when `next()` is called multiple times or after the response has finished.              |
| `ServiceUnavailableError`      | `503`  | `ERR_SERVICE_UNAVAILABLE`         | Thrown when server context pools or capacity limits are reached.                               |
| `DuplicateRouteError`          | `500`  | `ERR_DUPLICATE_ROUTE`             | Thrown during startup when registering duplicate HTTP method + path patterns.                  |

---
