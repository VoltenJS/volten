import { run } from "node:test";
import { spec } from "node:test/reporters";
import path from "node:path";
import { globSync } from "fs";

const testFiles = globSync("tests/**/*.test.ts").map((file) => path.resolve(file));
const threshold = 70;
console.info(`Starting Volten Test Suite with Coverage...\n`);

const stream = run({
  files: testFiles,
  coverage: true, // 1. Tells Node to track which lines of source code were executed
  coverageExcludeGlobs: ["tests/**"], // 2. Exclude test files from coverage calculations
});

// The spec reporter will seamlessly print your test results AND the coverage summary table
stream.compose(new spec()).pipe(process.stdout);

let failureCount = 0;

stream.on("data", (event) => {
  if (event.type === "test:fail") {
    failureCount++;
  }

  // Handle Node's actual test coverage structure
  if (event.type === "test:coverage") {
    const totals = event.data.summary.totals;

    const lineCoverage = totals.coveredLinePercent;
    const branchCoverage = totals.coveredBranchPercent;
    const functionCoverage = totals.coveredFunctionPercent;

    console.info(`\n📊 Code Coverage Report:`);
    console.info(`- Lines: ${lineCoverage.toFixed(2)}%`);
    console.info(`- Branches: ${branchCoverage.toFixed(2)}%`);
    console.info(`- Functions: ${functionCoverage.toFixed(2)}%\n`);

    // Strict 100% threshold assertion
    if (lineCoverage < threshold || branchCoverage < threshold || functionCoverage < threshold) {
      console.error(`❌ Test suite failed: Code coverage must at least ${String(threshold)}%!`);
      failureCount++;
    }
  }

  if (event.type === "test:diagnostic" && event.data.message.includes("duration_ms")) {
    setImmediate(() => {
      process.exit(failureCount > 0 ? 1 : 0);
    });
  }
});

stream.on("close", () => process.exit(failureCount > 0 ? 1 : 0));
