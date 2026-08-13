import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync as exec } from "node:child_process";
import Logger from "./logger.js";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const mainLogger = new Logger();

const pkgPath = path.join(PROJECT_ROOT, "package.json");
const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
const cleanName = pkg.name.replace(/^@/, "").replace(/\//g, "-");
const tarballName = `${cleanName}-${pkg.version}.tgz`;

mainLogger.meta(`Publishing ${pkg.name}@${pkg.version}...`);

const execOptions = { stdio: "inherit", encoding: "utf8" };
try {
  mainLogger.info("Packing...");
  exec("pnpm", ["pack:npm"], execOptions);
  mainLogger.success(`${tarballName} created successfully`);
} catch (e) {
  process.exit(1);
}

try {
  mainLogger.info("Publishing...");
  exec("pnpm", ["publish", tarballName, "--no-git-checks"], execOptions);
  mainLogger.success(`${tarballName} published successfully`);
} catch {
  process.exit(1);
}
