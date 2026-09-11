<script setup>
const cookieOptionsItems = [
  {
    property: 'httpOnly',
    type: 'boolean',
    default: 'false',
    description: 'Forbids JavaScript from accessing the cookie, mitigating XSS attacks.'
  },
  {
    property: 'secure',
    type: 'boolean',
    default: 'false',
    description: 'Ensures the cookie is only sent over HTTPS.'
  },
  {
    property: 'sameSite',
    type: '"lax" | "strict" | "none"',
    default: 'undefined',
    description: 'Controls whether the cookie is sent with cross-site requests.'
  },
  {
    property: 'maxAge',
    type: 'number',
    default: 'undefined',
    description: 'Relative max age of the cookie in seconds from when the client receives it.'
  },
  {
    property: 'expires',
    type: 'Date',
    default: 'undefined',
    description: 'Absolute expiration date for the cookie.'
  },
  {
    property: 'path',
    type: 'string',
    default: '"/"',
    description: 'The URL path that must exist in the requested URL to send the cookie.'
  },
  {
    property: 'domain',
    type: 'string',
    default: 'undefined',
    description: 'The host domain to which the cookie will be sent.'
  }
];
</script>

# Cookie Management

Volten provides built-in cookie parsing and serialization without external dependencies.

### Reading Cookies with `ctx.cookies`
Incoming cookies are automatically parsed into a key-value dictionary on `ctx.cookies`:

```typescript
app.get('/profile', (ctx) => {
  const sessionId = ctx.cookies.session_id;
  const theme = ctx.cookies.theme || 'light';

  return ctx.json({ sessionId, theme });
});
```

### Setting Cookies with `ctx.setCookie(name, value, options?)`
Sets an outgoing cookie header:

```typescript
app.post('/login', (ctx) => {
  ctx.setCookie('session_id', 'xyz987654321', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400, // 24 hours in seconds
    path: '/',
  });

  return ctx.json({ loggedIn: true });
});
```

### `CookieOptions` Reference

<ApiTable
  title="CookieOptions"
  description="Configuration options passed to ctx.setCookie(name, value, options)"
  :items="cookieOptionsItems"
/>



---