import { readdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, extname, basename } from "path";
import { fork } from "child_process";
import assert from "assert/strict";

// Global tracking metric
const testSummary = {
  passed: 0,
  failed: 0,
  details: [],
};

// Updated: Test functions now accept a dynamic `port` argument
const fileTests = {
  "01-hello-world.js": async (port) => {
    const res = await fetch(`http://localhost:${port}/`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(text, "Hello world!");
  },

  "02-middleware.js": async (port) => {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
  },

  "03-json-response.js": async (port) => {
    const res = await fetch(
      `http://localhost:${port}/api/v1/internal/users/99/statistics/detailed`,
    );
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(
      Object.keys(data).sort(),
      ["header", "metrics", "security", "subReports"].sort(),
    );
  },

  "04-routing-and-wildcards.js": async (port) => {
    const resParam = await fetch(`http://localhost:${port}/shop/electronics/mac-studio`);
    assert.equal(resParam.status, 200);

    const resQuery = await fetch(
      `http://localhost:${port}/api/v1/search?q=high-performance&limit=25`,
    );
    assert.equal(resQuery.status, 200);
  },

  "05-global-error-handling.js": async (port) => {
    const resHealthy = await fetch(`http://localhost:${port}/api/v1/healthy`);
    assert.equal(resHealthy.status, 200);

    const resExplode = await fetch(`http://localhost:${port}/api/v1/explode`);
    assert.equal(resExplode.status, 500);
  },

  "06-static-file-serving.js": async (port) => {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
  },

  "07-body-parsing.js": async (port) => {
    const jsonRes = await fetch(`http://localhost:${port}/api/v1/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "insanerx",
        email: "insanerx@volten.io",
        role: "lead",
      }),
    });
    assert.equal(jsonRes.status, 201);

    const textRes = await fetch(`http://localhost:${port}/api/v1/logs/raw`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "SYS_ERR_404: Database connection pool lost stability.",
    });
    assert.equal(textRes.status, 200);
  },

  "08-cookies-and-sessions.js": async (port) => {
    const blockRes = await fetch(`http://localhost:${port}/api/v1/dashboard`);
    assert.equal(blockRes.status, 401);

    const loginRes = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: "POST",
    });
    const cookie = loginRes.headers.get("set-cookie");
    assert.equal(loginRes.status, 200);
    assert.ok(cookie);
  },

  "09-stream-responses.js": async (port) => {
    const res = await fetch(`http://localhost:${port}/api/v1/stream/dataset`);
    assert.equal(res.status, 200);

    const reader = res.body.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    assert.ok(chunk.includes('"id":1'));
  },

  "10-cors-and-security.js": async (port) => {
    const preflightRes = await fetch(`http://localhost:${port}/api/v1/secure-data`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(preflightRes.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const dataRes = await fetch(`http://localhost:${port}/api/v1/secure-data`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(dataRes.status, 200);
  },
};

// Updated: Accept `port` as a parameter and pass it into the env context
function runServerAndTest(file, port) {
  return new Promise((resolve) => {
    console.log(`[Master] Booting server: ${file} on port ${port}`);

    // Inject PORT variable so the server file knows where to listen
    const child = fork(`${import.meta.dirname}/${file}`, [], {
      stdio: "pipe",
      env: { ...process.env, PORT: port.toString() },
    });
    child.tested = false;
    let testStarted = false;

    async function handleExecuteTest() {
      if (testStarted) return;
      testStarted = true;

      try {
        if (fileTests[file]) {
          await fileTests[file](port); // Pass port down to execution
          testSummary.passed++;
          testSummary.details.push({ file, status: "PASSED" });
        } else {
          testSummary.details.push({
            file,
            status: "SKIPPED (No tests configured)",
          });
        }
      } catch (err) {
        testSummary.failed++;
        testSummary.details.push({
          file,
          status: "FAILED",
          error: err.message,
        });
      } finally {
        child.tested = true;
        child.kill();
        resolve();
      }
    }

    child.on("message", async (msg) => {
      if (msg === "ready" || msg?.status === "ready") await handleExecuteTest();
    });

    const fallbackBootTimer = setTimeout(async () => {
      await handleExecuteTest();
    }, 1500);

    child.on("exit", async () => {
      if (!child.tested) {
        return;
      }
      clearTimeout(fallbackBootTimer);
      resolve();
    });
  });
}

async function startQueue() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const currentScript = basename(__filename);

    const files = await readdir(__dirname);
    const jsFiles = files
      .filter((file) => extname(file) === ".js" && file !== currentScript)
      .sort();

    console.log(`Found ${jsFiles.length} servers. Starting concurrent execution sequence...`);

    // BASE_PORT acts as the starting range for our concurrent channels
    const BASE_PORT = 3000;

    // Map files to promises running simultaneously with distinct ports
    const testPromises = jsFiles.map((file, index) => {
      const assignedPort = BASE_PORT + index;
      return runServerAndTest(file, assignedPort);
    });

    // Run everything in parallel
    await Promise.all(testPromises);

    // --- Summary Report Generation ---
    console.log("\n=============================================");
    console.log("                 TEST REPORT                 ");
    console.log("=============================================");

    // Sort details so the final output matches file order despite concurrent finishing times
    testSummary.details.sort((a, b) => a.file.localeCompare(b.file));

    testSummary.details.forEach((item) => {
      const badge = item.status === "PASSED" ? "✅" : "❌";
      if (item.error) {
        console.error(`${badge} ${item.file.padEnd(30)} -> ${item.status}`);
        console.error(`   └─ Error: ${item.error}`);
        return;
      }
      console.log(`${badge} ${item.file.padEnd(30)} -> ${item.status}`);
    });
    console.log("---------------------------------------------");
    console.log(
      `Total: ${testSummary.passed + testSummary.failed} | Passed: ${testSummary.passed} | Failed: ${testSummary.failed}`,
    );
    console.log("=============================================\n");

    if (testSummary.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error("Core automation failure:", error);
    process.exit(1);
  }
}

startQueue();
