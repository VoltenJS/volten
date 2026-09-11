export interface PlaygroundPreset {
  id: string
  name: string
  description: string
  curlCommand: string
  code: string
}

export const presets: PlaygroundPreset[] = [
  {
    id: 'basic',
    name: '1. Hello World',
    description: 'Basic server with route params, query handling & health stats',
    curlCommand: 'curl http://localhost:3000/hello/developer',
    code: `import { App } from 'volten';

const app = new App();

// Request logging middleware
app.use((ctx, next) => {
  console.log(\`[\${new Date().toLocaleTimeString()}] \${ctx.method} \${ctx.url}\`);
  return next();
});

// Root endpoint
app.get('/', (ctx) => {
  return ctx.json({
    framework: 'Volten',
    tagline: 'Simple, Modern, Fast',
    time: Date.now()
  });
});

// Parameterized route
app.get('/hello/:name', (ctx) => {
  const { name } = ctx.params;
  const { greeting = 'Hello' } = ctx.query;
  return ctx.send(\`\${greeting}, \${name}! Welcome to Volten.\`);
});

// Health check endpoint
app.get('/health', (ctx) => {
  return ctx.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage().rss
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`⚡ Volten Playground Server running on port \${PORT}\`);
  console.log(\`👉 Try: curl http://localhost:\${PORT}/hello/developer\`);
});
`
  },
  {
    id: 'rest',
    name: '2. REST API',
    description: 'Full CRUD REST API example with JSON body parsing and simulated database',
    curlCommand: 'curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d \'{"name":"Alice","email":"alice@example.com"}\'',
    code: `import { App } from 'volten';

const app = new App();

// Simulated database
const users = new Map();
let nextId = 1;

// Body parsing middleware for JSON
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' || ctx.method === 'PUT') {
    try {
      ctx.state.body = await ctx.json();
    } catch (e) {
      return ctx.status(400).json({ error: 'Invalid JSON' });
    }
  }
  return next();
});

// Create user
app.post('/users', (ctx) => {
  const body = ctx.state.body;
  if (!body?.name || !body?.email) {
    return ctx.status(400).json({ error: 'Name and email required' });
  }
  
  const user = { id: nextId++, ...body };
  users.set(user.id, user);
  
  return ctx.status(201).json(user);
});

// Read all users
app.get('/users', (ctx) => {
  return ctx.json(Array.from(users.values()));
});

// Read single user
app.get('/users/:id', (ctx) => {
  const id = parseInt(ctx.params.id);
  const user = users.get(id);
  
  if (!user) {
    return ctx.status(404).json({ error: 'User not found' });
  }
  return ctx.json(user);
});

// Delete user
app.delete('/users/:id', (ctx) => {
  const id = parseInt(ctx.params.id);
  if (!users.has(id)) {
    return ctx.status(404).json({ error: 'User not found' });
  }
  
  users.delete(id);
  return ctx.status(204).send('');
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`⚡ Volten REST API running on port \${PORT}\`);
  console.log(\`👉 Try: curl -X POST http://localhost:\${PORT}/users -d '{"name":"Alice","email":"alice@example.com"}'\`);
});
`
  },
  {
    id: 'middleware',
    name: '3. Middleware Pipeline',
    description: 'Demonstrates cascading middleware, error handling, and ctx.state mutation',
    curlCommand: 'curl -i http://localhost:3000/protected',
    code: `import { App } from 'volten';

const app = new App();

// 1. Global Error Handler Middleware
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error('Captured error:', err.message);
    ctx.status(err.status || 500).json({
      error: 'Internal Server Error',
      message: err.message
    });
  }
});

// 2. Performance Timing Middleware
app.use(async (ctx, next) => {
  const start = performance.now();
  await next();
  const ms = performance.now() - start;
  ctx.setHeader('X-Response-Time', \`\${ms.toFixed(3)}ms\`);
});

// 3. Authentication Middleware
const requireAuth = (ctx, next) => {
  const token = ctx.req.headers['authorization'];
  
  if (!token || token !== 'Bearer volten_secret') {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err; // Caught by Error Handler
  }
  
  // Mutate state for downstream handlers
  ctx.state.user = { id: 99, role: 'admin' };
  return next();
};

// Public route
app.get('/public', (ctx) => {
  return ctx.send('Anyone can see this!');
});

// Protected route (uses auth middleware)
app.get('/protected', requireAuth, (ctx) => {
  return ctx.json({
    message: 'Welcome to the secret area!',
    user: ctx.state.user
  });
});

// Intentional crash route
app.get('/crash', (ctx) => {
  throw new Error('Oops! Something broke.');
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`⚡ Volten Middleware Server running on port \${PORT}\`);
  console.log(\`👉 Try: curl -H "Authorization: Bearer volten_secret" http://localhost:\${PORT}/protected\`);
});
`
  },
  {
    id: 'jit',
    name: '4. JIT & Streaming',
    description: 'High-performance streaming responses and adaptive JIT object pooling',
    curlCommand: 'curl -N http://localhost:3000/api/stream',
    code: `import { App } from 'volten';

const app = new App();

// Server-Sent Events (SSE) Streaming
app.get('/api/stream', async (ctx) => {
  ctx.setHeader('Content-Type', 'text/event-stream');
  ctx.setHeader('Cache-Control', 'no-cache');
  ctx.setHeader('Connection', 'keep-alive');
  
  // Write headers immediately
  ctx.res.writeHead(200);

  // Stream 5 messages over 5 seconds
  for (let i = 1; i <= 5; i++) {
    const data = JSON.stringify({ 
      event: 'tick', 
      count: i, 
      timestamp: Date.now() 
    });
    
    ctx.res.write(\`data: \${data}\\n\\n\`);
    
    // Wait 1 second
    await new Promise(r => setTimeout(r, 1000));
  }
  
  ctx.res.write('event: done\\ndata: {}\\n\\n');
  ctx.res.end();
});

// Large JSON Payload (JIT optimized internally by Volten)
app.get('/api/large-data', (ctx) => {
  const records = Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    uuid: crypto.randomUUID(),
    active: i % 2 === 0,
    score: Math.random() * 100
  }));
  
  // Volten's Adaptive JIT Engine will automatically optimize
  // the serialization of this large array on hot paths
  return ctx.json({
    total: records.length,
    data: records
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`⚡ Volten JIT & Stream Server running on port \${PORT}\`);
  console.log(\`👉 Try: curl -N http://localhost:\${PORT}/api/stream\`);
});
`
  }
];
