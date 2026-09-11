# Middleware

Middleware functions in Volten intercept incoming HTTP requests and outgoing responses. They can inspect and modify headers, validate authentication tokens, mutate request state, short-circuit pipelines, or log execution metrics.

Volten implements an **Onion Execution Model** combined with **compiled middleware chains** for maximum performance and zero overhead.

---