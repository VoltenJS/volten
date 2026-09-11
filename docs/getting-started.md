# Getting Started

Welcome to the Volten documentation!

Volten is an incredibly fast, 0-dependency Node.js HTTP framework. It is built purely on top of Node.js primitives to offer an `Express`-like developer experience while utilizing a highly optimized routing tree and an Adaptive JIT Engine.

## Installation

You can install Volten using your favorite package manager:

::: code-group

```bash [npm]
npm install volten
```

```bash [pnpm]
pnpm add volten
```

```bash [yarn]
yarn add volten
```

```bash [bun]
bun add volten
```

:::

## Basic Usage

Here is a simple example to get your server running:

```typescript
import { App } from "volten";

const app = new App();

app.get("/", (ctx) => {
  ctx.send("Hello World!");
});

app.get("/user/:id", (ctx) => {
  const userId = ctx.params.id;
  ctx.json({ userId });
});

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
```

To run this, simply execute:

```bash
node server.js
```

### Next Steps

Now that your server is running, check out the core concepts:

- [Routing](/guide/routing): Learn how to handle different methods, wildcards, and parameters.
- [Context (ctx)](/guide/context): Learn about the powerful `ctx` object used to send responses and read requests.
