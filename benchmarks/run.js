import autocannon from 'autocannon';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runBenchmark(opts = {}) {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, BENCHMARK_LOGGING: 'false' }
    });

    // Give the server a second to start
    setTimeout(() => {
      const config = {
        url: 'http://127.0.0.1:3000/user/123',
        connections: 100,
        pipelining: 10,
        duration: opts.duration || 10, // 10s default
        ...opts
      };
      
      const instance = autocannon(config, (err, result) => {
        serverProcess.kill('SIGKILL');
        if (err) return reject(err);
        resolve(result);
      });

      if (opts.track !== false) {
        autocannon.track(instance, { renderProgressBar: true });
      }
    }, 1000);
  });
}

// If run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Starting Volten benchmark...');
  runBenchmark()
    .then(result => {
      console.log('\n--- Benchmark Results ---');
      console.log(`Req/Sec:       ${result.requests.average.toLocaleString()}`);
      console.log(`Latency (avg): ${result.latency.average} ms`);
      console.log(`Throughput:    ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`);
      console.log(`Errors:        ${result.errors}`);
      console.log('-------------------------\n');
    })
    .catch(console.error);
}
