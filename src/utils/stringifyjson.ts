import { RequestContext } from "./requestCtx.ts";
const OBJ_STACK = new Array(32);

export function getShapeFingerprint(obj: unknown): number {
  let hash = 2166136261;
  let sp = 0;
  OBJ_STACK[sp++] = obj;

  while (sp > 0) {
    const val = OBJ_STACK[--sp];

    if (val === null) {
      hash = Math.imul(hash ^ 1, 16777619);
      continue;
    }

    const type = typeof val;
    switch (type) {
      case "object":
        if (Array.isArray(val)) {
          hash = Math.imul(hash ^ 6, 16777619);
          const len = val.length;
          if (len > 0 && sp < 29) {
            OBJ_STACK[sp++] = val[0];
            if (len > 1) OBJ_STACK[sp++] = val[len - 1];
            if (len > 5) OBJ_STACK[sp++] = val[len >> 1];
          }
        } else {
          hash = Math.imul(hash ^ 7, 16777619);
          const keys = Object.keys(val);
          const kLen = keys.length;
          for (let j = 0; j < kLen; j++) {
            const key = keys[j];
            hash = Math.imul(hash ^ key.length, 16777619);
            hash = Math.imul(hash ^ key.charCodeAt(0), 16777619);
            if (sp < 32) OBJ_STACK[sp++] = val[key];
            if (j > 14) break;
          }
        }
        break;
      case "number":
        hash = Math.imul(hash ^ 3, 16777619);
        break;
      case "string":
        hash = Math.imul(hash ^ 4, 16777619);
        break;
      case "boolean":
        hash = Math.imul(hash ^ 5, 16777619);
        break;
      case "undefined":
        hash = Math.imul(hash ^ 2, 16777619);
        break;
      case "function":
        hash = Math.imul(hash ^ 8, 16777619);
        break;
      default:
        hash = Math.imul(hash ^ 10, 16777619);
    }
  }
  const result = hash >>> 0;
  return result === 0 ? 1 : result;
}

/* -- Commented-out reference code (not used, kept for documentation) --

// for refernce only (also wont be efficeint sicne i switched the way i JIT compile)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function stringifyJSON(sample: unknown) {
  const parts: string[] = [];

  function build(obj: unknown) {
    if (obj === null || obj === undefined) {
      parts.push("null");
      return;
    }

    const type = typeof obj;
    if (type === "string") {
      parts.push(`${JSON.stringify(obj)}`);
    } else if (type === "number" || type === "boolean") {
      parts.push(`${obj}`);
    } else if (Array.isArray(obj)) {
      parts.push("[");
      parts.push(`${obj.map((v) => JSON.stringify(v)).join(",")}`);
      parts.push("]");
    } else if (type === "object") {
      parts.push("{");

      const currentObj = obj as Record<string, unknown>;
      const keys = Object.keys(currentObj);

      keys.forEach((key, i) => {
        parts.push(`"${key}":`);
        build(currentObj[key]);
        if (i < keys.length - 1) parts.push(",");
      });
      parts.push("}");
    }
  }

  build(sample);
  return parts.join("");
}

// Not used anymore. Only kept for reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleString(path: string, lines: string[]) {
  lines.push(`ctx.responseBuffer[ctx.bufferOffset++] = 34;`);

  const sVar = `s${lines.length}`;
  const needsEscapeVar = `e${lines.length}`;

  lines.push(`
    const ${sVar} = ${path};
    let ${needsEscapeVar} = false;

    // Scan for chars that MUST be escaped
    for (let j = 0; j < ${sVar}.length; j++) {
      const c = ${sVar}.charCodeAt(j);
      if (c < 32 || c === 34 || c === 92) {
        ${needsEscapeVar} = true;
        break;
      }
    }

    if (!${needsEscapeVar}) {
      ctx.bufferOffset += ctx.responseBuffer.write(${sVar}, ctx.bufferOffset);
    } else {
      const escaped = JSON.stringify(${sVar});
      ctx.bufferOffset += ctx.responseBuffer.write(escaped.slice(1, -1), ctx.bufferOffset);
    }
  `);

  lines.push(`ctx.responseBuffer[ctx.bufferOffset++] = 34;`);
}

*/

export function createCompiledStringifier(sample: unknown) {
  const lines: string[] = [];

  // Helper to escape strings for the generated code
  const esc = (s: string) => JSON.stringify(s);

  function build(obj: unknown, path: string) {
    if (obj === null) {
      lines.push(`ctx.writeStatic('null');`);
      return;
    }

    const type = typeof obj;

    if (type === "string") {
      lines.push(`ctx.writeStatic(JSON.stringify(${path}));`);
    } else if (type === "number" || type === "boolean") {
      lines.push(`ctx.writeStatic(String(${path}));`);
    } else if (Array.isArray(obj)) {
      lines.push(`ctx.writeStatic('[');`);
      const i = `i${lines.length}`;
      lines.push(`for (let ${i} = 0; ${i} < ${path}.length; ${i}++) {`);

      // RUNTIME CHECK: Since the array is mixed, we can't pre-compile the items
      lines.push(`
      const val = ${path}[${i}];
      if (typeof val === 'object' && val !== null) {
        ctx.writeStatic(JSON.stringify(val));
      } else {
        ctx.writeStatic(JSON.stringify(val));
      }
    `);

      lines.push(`if (${i} < ${path}.length - 1) ctx.writeStatic(',');`);
      lines.push(`}`);
      lines.push(`ctx.writeStatic(']');`);
    } else if (type === "object") {
      lines.push(`ctx.writeStatic('{');`);
      const currentObj = obj as Record<string, unknown>;
      const keys = Object.keys(currentObj);
      keys.forEach((key, index) => {
        // JSON keys MUST be quoted
        lines.push(`ctx.writeStatic(${esc(esc(key) + ":")});`);
        build(currentObj[key], `${path}[${esc(key)}]`);
        if (index < keys.length - 1) lines.push(`ctx.writeStatic(',');`);
      });
      lines.push(`ctx.writeStatic('}');`);
    }
  }

  build(sample, "d");

  const fnBody = lines.join("\n");

  try {
    // Generate the optimized function
    return new Function("d", "ctx", fnBody) as (
      d: unknown,
      ctx: RequestContext,
    ) => void;
  } catch {
    // Fallback to standard stringify if the JIT fails
    return (d: unknown, ctx: RequestContext) =>
      ctx.writeStatic(JSON.stringify(d));
  }
}
