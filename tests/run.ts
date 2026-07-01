import { run } from "node:test";
import { spec } from "node:test/reporters";
import path from "node:path";
import { globSync } from "fs";

const testFiles = globSync("tests/**/*.test.ts").map((file) =>
  path.resolve(file),
);
const threshold = 85;
console.log(`Starting Volten Test Suite with Coverage...\n`);

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

    console.log(`\n📊 Code Coverage Report:`);
    console.log(`- Lines: ${lineCoverage.toFixed(2)}%`);
    console.log(`- Branches: ${branchCoverage.toFixed(2)}%`);
    console.log(`- Functions: ${functionCoverage.toFixed(2)}%\n`);

    // Strict 100% threshold assertion
    if (
      lineCoverage < threshold ||
      branchCoverage < threshold ||
      functionCoverage < threshold
    ) {
      console.error(
        `❌ Test suite failed: Code coverage must at least ${threshold}%!`,
      );
      failureCount++;
    }
  }

  if (
    event.type === "test:diagnostic" &&
    event.data?.message?.includes("duration_ms")
  ) {
    setImmediate(() => {
      process.exit(failureCount > 0 ? 1 : 0);
    });
  }
});

stream.on("close", () => process.exit(failureCount > 0 ? 1 : 0));
