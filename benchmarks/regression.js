import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBenchmark } from './run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, 'baseline.json');

const isUpdate = process.argv.includes('--update');

async function main() {
  console.log(`Running regression benchmark (duration: 15s)...`);
  
  // Disable progress bar for cleaner CI output
  const result = await runBenchmark({ duration: 15, track: false });
  const currentReqPerSec = result.requests.average;

  if (isUpdate) {
    const data = {
      timestamp: new Date().toISOString(),
      requestsPerSec: currentReqPerSec,
      latency: result.latency.average,
    };
    await fs.writeFile(BASELINE_PATH, JSON.stringify(data, null, 2));
    console.log(`✅ Baseline updated successfully: ${currentReqPerSec.toLocaleString()} req/sec`);
    process.exit(0);
  } else {
    let baselineData;
    try {
      const fileContent = await fs.readFile(BASELINE_PATH, 'utf-8');
      baselineData = JSON.parse(fileContent);
    } catch (e) {
      console.error('❌ Could not read baseline.json. Run "pnpm run bench:update" first.');
      process.exit(1);
    }

    const baselineReqPerSec = baselineData.requestsPerSec;
    const threshold = baselineReqPerSec * 0.95; // Max 5% drop allowed

    console.log(`\n--- Regression Check ---`);
    console.log(`Baseline: ${baselineReqPerSec.toLocaleString()} req/sec`);
    console.log(`Current:  ${currentReqPerSec.toLocaleString()} req/sec`);
    console.log(`Threshold (95%): ${threshold.toLocaleString()} req/sec`);

    const diffPercent = ((currentReqPerSec - baselineReqPerSec) / baselineReqPerSec * 100).toFixed(2);
    console.log(`Difference: ${diffPercent > 0 ? '+' : ''}${diffPercent}%`);

    if (currentReqPerSec < threshold) {
      console.error(`\n❌ REGRESSION DETECTED: Performance dropped by more than 5%.`);
      process.exit(1);
    } else {
      console.log(`\n✅ Performance is within acceptable limits.`);
      process.exit(0);
    }
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
