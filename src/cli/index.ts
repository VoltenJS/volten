#!/usr/bin/env node

import path from "path";
import fs from "fs";
import { replaySnapshot } from "../tools/drr/replay.ts";
import { renderForensicReport } from "./renderer.ts";
import type { App } from "../core/server.ts";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] !== "replay" || args.length < 3) {
    console.error("Usage: volten replay <path-to-app.ts> <path-to-crash.vltn>");
    process.exit(1);
  }

  const appPathArg = args[1] as string;
  const crashPathArg = args[2] as string;

  const appPath = path.resolve(process.cwd(), appPathArg);
  const crashPath = path.resolve(process.cwd(), crashPathArg);

  if (!fs.existsSync(appPath)) {
    console.error(`Error: App entrypoint not found at ${appPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(crashPath)) {
    console.error(`Error: Snapshot file not found at ${crashPath}`);
    process.exit(1);
  }

  // Set the replay flag BEFORE loading the app, so that the router is compiled with trace hooks
  process.env.VOLTEN_DRR_REPLAY = "1";

  let appModule: Record<string, unknown> | undefined;
  try {
    // Dynamic import to ensure the env var is set before evaluation
    // We use a file:// URI to support loading absolute paths in ESM/CJS reliably across OSes
    appModule = (await import(`file://${appPath}`)) as Record<string, unknown>;
  } catch (err: unknown) {
    console.error(`Error: Failed to load app entrypoint from ${appPath}`);
    console.error(err);
    process.exit(1);
  }

  // Find the App instance exported by the file
  let app: App | undefined;

  if (
    appModule["default"] !== undefined &&
    typeof (appModule["default"] as App).listen === "function"
  ) {
    app = appModule["default"] as App;
  } else if (
    appModule["app"] !== undefined &&
    typeof (appModule["app"] as App).listen === "function"
  ) {
    app = appModule["app"] as App;
  } else {
    // Search exports for an instance of App
    for (const key of Object.keys(appModule)) {
      const val = appModule[key] as App | undefined;
      if (
        val !== undefined &&
        typeof val.listen === "function" &&
        typeof val.handleRequest === "function"
      ) {
        app = val;
        break;
      }
    }
  }

  if (app === undefined) {
    console.error(`Error: Could not find an exported Volten App instance in ${appPath}.`);
    console.error(`Ensure you export your app instance (e.g., 'export const app = new App()').`);
    process.exit(1);
  }

  try {
    const result = await replaySnapshot(app, crashPath);
    if (result !== null) {
      renderForensicReport(result);
    } else {
      console.error("Replay returned null.");
      process.exit(1);
    }
  } catch (err: unknown) {
    console.error(`Error: Forensic replay failed due to a fatal error reading the snapshot.`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
