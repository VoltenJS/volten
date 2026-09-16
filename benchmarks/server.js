import { App } from '../dist/index.js';

const app = new App();

app.get('/', (ctx) => {
  ctx.send('Hello World!');
});

app.get('/user/:id', (ctx) => {
  ctx.send(`User: ${ctx.params.id}`);
});

app.listen(3000, () => {
  if (process.env.BENCHMARK_LOGGING === 'true') {
    console.log('Benchmark server listening on port 3000');
  }
});
