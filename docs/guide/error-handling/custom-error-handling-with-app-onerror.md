# Custom Error Handling with app.onError

You can register an application-wide custom error handler using `app.onError()`:

```typescript
import { App, VoltenError } from 'volten';

const app = new App();

app.onError((err, ctx) => {
  // Normalize error instance
  const error = VoltenError.from(err);
  const status = error.statusCode || 500;

  // Custom logging
  console.error(`[Error] ${ctx.method} ${ctx.path} -> ${error.code}: ${error.message}`);

  // Send formatted response
  return ctx.status(status).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
});
```

### Safety Guarantees

Volten includes safeguards for your custom error handler:

1. **Unterminated Response Protection**: If your `onError` handler executes but forgets to send a response (or doesn't call `ctx.send()`, `ctx.json()`, etc.), Volten detects that `ctx.sent` is `false`, logs a warning, and executes the default core error handler.
2. **Crash Resilience**: If your custom error handler itself throws an exception or crashes, Volten intercepts the crash and invokes the fallback core error handler to ensure the connection is terminated cleanly.
3. **Socket Cleanup**: If the error occurs after headers have already been sent to the network (`ERR_HEADERS_SENT`), the underlying socket is safely destroyed to avoid hanging connections.

### Clearing the Error Handler

To remove the custom error handler and revert to the built-in default behavior:

```typescript
app.clearErrorHandler();
```

---