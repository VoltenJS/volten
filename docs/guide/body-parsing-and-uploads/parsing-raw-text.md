# Parsing Raw Text

If you need the unprocessed string content of the request body—such as when verifying signatures for Stripe or GitHub webhooks—pass `'text'` to `ctx.body()`:

```typescript
app.post("/webhook", async (ctx) => {
  const rawBody = (await ctx.body("text")) as string;
  const signature = ctx.headers["stripe-signature"];

  // Verify webhook signature with the raw string
  const isValid = verifySignature(rawBody, signature);
  if (!isValid) {
    return ctx.status(400).send("Invalid signature");
  }

  return ctx.status(200).send("Webhook received");
});
```

::: tip
Calling `ctx.body('text')` bypasses JSON parsing completely and returns the raw UTF-8 string payload.
:::

---
