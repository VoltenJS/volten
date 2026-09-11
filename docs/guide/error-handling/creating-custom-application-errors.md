# Creating Custom Application Errors

You can create your own domain-specific errors by extending `VoltenError`:

```typescript
import { VoltenError } from "volten";

export class UnauthorizedError extends VoltenError {
  constructor(message: string = "Authentication required") {
    super("ERR_UNAUTHORIZED", message, 401);
  }
}

export class ValidationError extends VoltenError {
  public readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super("ERR_VALIDATION_FAILED", "Validation failed", 422);
    this.fields = fields;
  }
}
```

Now, throw them anywhere in your routes or middleware:

```typescript
app.get("/dashboard", (ctx) => {
  const token = ctx.headers["authorization"];
  if (!token) {
    throw new UnauthorizedError();
  }

  return ctx.json({ secret: "data" });
});
```

When caught by your `app.onError` handler, `err` will preserve its status code (`401`), error code (`ERR_UNAUTHORIZED`), and custom fields.
