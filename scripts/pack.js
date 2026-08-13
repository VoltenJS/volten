import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync as exec } from "node:child_process";
import Logger, { ansi } from "./logger.js";
import { ESLint } from "eslint";
import { create } from "tar";

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGING_DIR = path.join(PROJECT_ROOT, ".pack-staging", "package");
const OUTPUT_DIR = PROJECT_ROOT;

const FILES_TO_PACK = ["package.json", "README.npm.md", "LICENSE", "dist"];

const ALIASES = {
  "README.npm.md": "README.md",
};

const mainLogger = new Logger();
const checksLogger = new Logger(ansi.brightBlue.bold.text("[CHECKS]"));
const packLogger = new Logger(ansi.brightYellow.text("[PACK]  "));

const pkgPath = path.join(PROJECT_ROOT, "package.json");
const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));

mainLogger.meta(`Packing ${pkg.name}@${pkg.version}...`);

async function checkCode() {
  const execOptions = { stdio: "pipe", encoding: "utf8", cwd: PROJECT_ROOT };

  try {
    checksLogger.info("Running Linting");
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const results = await eslint.lintFiles("src/**/*.ts");
    const formatter = await eslint.loadFormatter("stylish");
    const resultText = formatter.format(results);

    if (resultText !== "") {
      throw { stderr: resultText };
    }
    checksLogger.success("Linting Passed");
  } catch (e) {
    e.stderr ? checksLogger.error(e.stderr) : checksLogger.errorWithTrace(e);
    process.exit(1);
  }

  try {
    checksLogger.info("Running Tests");
    exec("pnpm", ["test"], execOptions);
    checksLogger.success("Tests Passed");
  } catch (e) {
    checksLogger.error("Tests Failed");
    process.exit(1);
  }

  try {
    checksLogger.info("Formatting with prettier");
    exec("pnpm", ["format"], execOptions);
    checksLogger.success("Files Formatted");
  } catch (e) {
    checksLogger.error("Formatting Failed");
    process.exit(1);
  }

  try {
    checksLogger.info("Building");
    await fs.rm(path.join(PROJECT_ROOT, "dist"), { recursive: true, force: true });
    exec("pnpm", ["tsup"], execOptions);
    checksLogger.success("Building Succeeded");
  } catch (e) {
    checksLogger.error(e.stderr || e.stdout || "Build failed");
    process.exit(1);
  }

  try {
    checksLogger.info("Running Examples (with examples/automate.js)");
    exec("node", ["examples/automate.js"], execOptions);
    checksLogger.success("Examples Passed");
  } catch (e) {
    checksLogger.error(e.stderr || e.stdout || "Examples failed");
    process.exit(1);
  }
}

async function createPack() {
  try {
    const cleanName = pkg.name.replace(/^@/, "").replace(/\//g, "-");
    const tarballName = `${cleanName}-${pkg.version}.tgz`;
    const outputPath = path.join(OUTPUT_DIR, tarballName);

    await fs.rm(path.dirname(STAGING_DIR), { recursive: true, force: true });
    await fs.mkdir(STAGING_DIR, { recursive: true });

    for (const file of FILES_TO_PACK) {
      const src = path.join(PROJECT_ROOT, file);
      const dest = path.join(STAGING_DIR, ALIASES[file] ?? file);

      try {
        const stats = await fs.stat(src);
        if (stats.isDirectory()) {
          await fs.cp(src, dest, { recursive: true });
        } else {
          await fs.copyFile(src, dest);
        }
        packLogger.debug(`Copied: ${file} ${ALIASES[file] ? `as ${ALIASES[file]}` : ""}`);
      } catch (err) {
        if (err.code === "ENOENT") {
          packLogger.warn(`Skipping missing file: ${file}`);
        } else {
          throw err;
        }
      }
    }

    packLogger.info(`Compressing into ${tarballName}...`);
    await create(
      {
        gzip: true,
        file: outputPath,
        cwd: path.dirname(STAGING_DIR),
      },
      ["package"],
    );

    packLogger.success(`Successfully created: ${tarballName}`);
  } catch (error) {
    packLogger.errorWithTrace(error);
    process.exitCode = 1;
  } finally {
    await fs.rm(path.dirname(STAGING_DIR), { recursive: true, force: true });
  }
}

async function main() {
  await checkCode();
  mainLogger.info(`${"#".repeat(10)} ALL CHECKS PASSED ${"#".repeat(10)}`);
  await createPack();
}

main();
