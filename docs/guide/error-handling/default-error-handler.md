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

---
