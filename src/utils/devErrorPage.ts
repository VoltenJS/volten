import fs from "node:fs";
import path from "node:path";

/**
 * Returns true only when the process is running in development mode.
 */
export function isDevMode(): boolean {
  return process.env["NODE_ENV"] === "development";
}

/**
 * Parses a Node.js stack trace string and extracts the first meaningful frame
 * pointing to a user-land source file (excluding node_modules and node internals).
 */
function parseFirstUserFrame(stack: string): {
  file: string;
  line: number;
  col: number;
} | null {
  const lines = stack.split("\n");
  for (const line of lines) {
    const match = /at .+ \((.+):(\d+):(\d+)\)/.exec(line) ?? /at ()(.+):(\d+):(\d+)/.exec(line);
    if (match === null) continue;

    const file = match[1] ?? "";
    const lineNo = parseInt(match[2] ?? "0", 10);
    const colNo = parseInt(match[3] ?? "0", 10);

    if (file.includes("node_modules") || file.startsWith("node:") || file === "") {
      continue;
    }

    return { file, line: lineNo, col: colNo };
  }
  return null;
}

/**
 * Attempts to read lines from a source file around the failing line number
 * and returns them as HTML with the failing line highlighted.
 */
function buildSourceSnippet(file: string, failingLine: number): string {
  try {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    const start = Math.max(0, failingLine - 5);
    const end = Math.min(lines.length, failingLine + 4);
    let html = "";
    for (let i = start; i < end; i++) {
      const lineNum = i + 1;
      const isTarget = lineNum === failingLine;
      const lineContent = escapeHtml(lines[i] ?? "");
      const cls = isTarget ? "line line-highlight" : "line";
      html += `<span class="${cls}"><span class="line-num">${String(lineNum).padStart(4, " ")}</span>  ${lineContent}</span>\n`;
    }
    return html;
  } catch {
    return "<span class='line'>Could not read source file.</span>";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generates a beautiful development-mode HTML error page for a 500 Internal Server Error.
 * This function is a no-op (returns null) when NODE_ENV !== 'development'.
 */
export function buildDevErrorPage(err: Error): string | null {
  if (!isDevMode()) return null;

  const stack = err.stack ?? `${err.name}: ${err.message}`;
  const frame = parseFirstUserFrame(stack);

  const fileName = frame !== null ? path.basename(frame.file) : "unknown";
  const filePath = frame !== null ? frame.file : "";
  const lineNo = frame !== null ? frame.line : 0;

  const sourceSnippet = frame !== null ? buildSourceSnippet(frame.file, frame.line) : "";

  const stackHtml = escapeHtml(stack)
    .split("\n")
    .map((l) => `<span class="stack-line">${l}</span>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(err.name)}: ${escapeHtml(err.message)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e0e0e0; padding: 2rem; }
    h1 { font-size: 1.6rem; color: #ff6b6b; margin-bottom: 0.5rem; word-break: break-word; }
    .subtitle { color: #aaa; font-size: 0.9rem; margin-bottom: 2rem; }
    .badge { background: #ff6b6b22; border: 1px solid #ff6b6b55; color: #ff6b6b; border-radius: 4px; padding: 0.15rem 0.5rem; font-size: 0.8rem; margin-right: 0.5rem; }
    .card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
    .card-header { background: #1e2130; padding: 0.75rem 1rem; font-size: 0.85rem; color: #888; border-bottom: 1px solid #2a2d3a; display: flex; align-items: center; gap: 0.5rem; }
    .card-header .filename { color: #7eb3ff; font-weight: 600; }
    .card-header .location { color: #aaa; }
    pre { padding: 1rem; overflow-x: auto; font-size: 0.85rem; line-height: 1.7; }
    .line { display: block; }
    .line-highlight { background: #ff6b6b18; border-left: 3px solid #ff6b6b; padding-left: 0.5rem; margin-left: -0.5rem; color: #ff9f9f; }
    .line-num { display: inline-block; width: 3rem; color: #555; user-select: none; }
    .stack-line { display: block; color: #888; }
    .stack-line:first-child { color: #ff6b6b; }
    .env-pill { display: inline-block; background: #ffc10722; border: 1px solid #ffc10755; color: #ffc107; border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.75rem; }
    footer { margin-top: 2rem; color: #555; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1><span class="badge">500</span>${escapeHtml(err.name)}: ${escapeHtml(err.message)}</h1>
  <p class="subtitle">
    <span class="env-pill">development</span>
    This error page is only visible in <code>NODE_ENV=development</code>. In production, a plain 500 is returned.
  </p>

  ${
    frame !== null
      ? `<div class="card">
    <div class="card-header">
      <span>📄 Source</span>
      <span class="filename">${escapeHtml(fileName)}</span>
      <span class="location">line ${String(lineNo)} &mdash; ${escapeHtml(filePath)}</span>
    </div>
    <pre>${sourceSnippet}</pre>
  </div>`
      : ""
  }

  <div class="card">
    <div class="card-header">📋 Stack Trace</div>
    <pre>${stackHtml}</pre>
  </div>

  <footer>Volten Framework &mdash; Dev Mode Error Page</footer>
</body>
</html>`;
}
