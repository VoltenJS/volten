const ANSI = {
  // Reset all formatting
  reset: "\x1b[0m",

  // Modifiers
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  blink: "\x1b[5m",
  rapidBlink: "\x1b[6m",
  inverse: "\x1b[7m",
  hidden: "\x1b[8m",
  strikethrough: "\x1b[9m",

  // Foreground Colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright Foreground Colors
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // Background Colors
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",

  // Bright Background Colors
  bgBrightBlack: "\x1b[100m",
  bgBrightRed: "\x1b[101m",
  bgBrightGreen: "\x1b[102m",
  bgBrightYellow: "\x1b[103m",
  bgBrightBlue: "\x1b[104m",
  bgBrightMagenta: "\x1b[105m",
  bgBrightCyan: "\x1b[106m",
  bgBrightWhite: "\x1b[107m",
};

class AnsiBuilder {
  constructor(activeCodes = []) {
    this.activeCodes = activeCodes;
  }

  // Modifiers
  get bold() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bold]);
  }
  get dim() {
    return new AnsiBuilder([...this.activeCodes, ANSI.dim]);
  }
  get italic() {
    return new AnsiBuilder([...this.activeCodes, ANSI.italic]);
  }
  get underline() {
    return new AnsiBuilder([...this.activeCodes, ANSI.underline]);
  }
  get blink() {
    return new AnsiBuilder([...this.activeCodes, ANSI.blink]);
  }
  get rapidBlink() {
    return new AnsiBuilder([...this.activeCodes, ANSI.rapidBlink]);
  }
  get inverse() {
    return new AnsiBuilder([...this.activeCodes, ANSI.inverse]);
  }
  get hidden() {
    return new AnsiBuilder([...this.activeCodes, ANSI.hidden]);
  }
  get strikethrough() {
    return new AnsiBuilder([...this.activeCodes, ANSI.strikethrough]);
  }

  // Foreground Colors
  get black() {
    return new AnsiBuilder([...this.activeCodes, ANSI.black]);
  }
  get red() {
    return new AnsiBuilder([...this.activeCodes, ANSI.red]);
  }
  get green() {
    return new AnsiBuilder([...this.activeCodes, ANSI.green]);
  }
  get yellow() {
    return new AnsiBuilder([...this.activeCodes, ANSI.yellow]);
  }
  get blue() {
    return new AnsiBuilder([...this.activeCodes, ANSI.blue]);
  }
  get magenta() {
    return new AnsiBuilder([...this.activeCodes, ANSI.magenta]);
  }
  get cyan() {
    return new AnsiBuilder([...this.activeCodes, ANSI.cyan]);
  }
  get white() {
    return new AnsiBuilder([...this.activeCodes, ANSI.white]);
  }

  // Bright Foreground Colors
  get brightBlack() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightBlack]);
  }
  get brightRed() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightRed]);
  }
  get brightGreen() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightGreen]);
  }
  get brightYellow() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightYellow]);
  }
  get brightBlue() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightBlue]);
  }
  get brightMagenta() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightMagenta]);
  }
  get brightCyan() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightCyan]);
  }
  get brightWhite() {
    return new AnsiBuilder([...this.activeCodes, ANSI.brightWhite]);
  }

  // Background Colors
  get bgBlack() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBlack]);
  }
  get bgRed() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgRed]);
  }
  get bgGreen() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgGreen]);
  }
  get bgYellow() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgYellow]);
  }
  get bgBlue() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBlue]);
  }
  get bgMagenta() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgMagenta]);
  }
  get bgCyan() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgCyan]);
  }
  get bgWhite() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgWhite]);
  }

  // Bright Background Colors
  get bgBrightBlack() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightBlack]);
  }
  get bgBrightRed() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightRed]);
  }
  get bgBrightGreen() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightGreen]);
  }
  get bgBrightYellow() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightYellow]);
  }
  get bgBrightBlue() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightBlue]);
  }
  get bgBrightMagenta() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightMagenta]);
  }
  get bgBrightCyan() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightCyan]);
  }
  get bgBrightWhite() {
    return new AnsiBuilder([...this.activeCodes, ANSI.bgBrightWhite]);
  }

  /**
   * Supports dynamic 8-bit color codes (0-255)
   */
  color256(code) {
    return new AnsiBuilder([...this.activeCodes, `\x1b[38;5;${code}m`]);
  }

  /**
   * Supports dynamic 8-bit background color codes (0-255)
   */
  bg256(code) {
    return new AnsiBuilder([...this.activeCodes, `\x1b[48;5;${code}m`]);
  }

  /**
   * Supports dynamic 24-bit True Color (RGB)
   */
  rgb(r, g, b) {
    return new AnsiBuilder([...this.activeCodes, `\x1b[38;2;${r};${g};${b}m`]);
  }

  /**
   * Supports dynamic 24-bit True Color Background (RGB)
   */
  bgRgb(r, g, b) {
    return new AnsiBuilder([...this.activeCodes, `\x1b[48;2;${r};${g};${b}m`]);
  }

  // The final execution wrapper
  text(str) {
    return `${this.activeCodes.join("")}${str}${ANSI.reset}`;
  }
}

export const ansi = new AnsiBuilder();

const errorPalette = {
  label: ansi.bold.red, // High visibility for the core problem
  plugin: ansi.bold.cyan, // Distinct blue-green for architectural components
  configKey: ansi.yellow, // Yellow for specific offending parameters
  muted: ansi.dim.brightBlack, // Faint gray for standard stack trace noise
};

const loggerPalette = {
  error: ansi.bold.red, // High urgency, demands immediate attention
  warn: ansi.bold.yellow, // Cautionary, stands out without screaming
  info: ansi.bold.cyan, // Operational info, clean and distinct from data
  success: ansi.bold.green, // Positive confirmation
  debugTag: ansi.bold.brightBlack, // Muted gray, but bolded for structure
  debugText: ansi.brightBlack, // Muted gray, standard weight
  meta: ansi.bold.magenta,
  text: ansi.white, // Standard text color for readability
};

export function displayError(validError) {
  const stackLines = validError.stack?.split("\n") || [];
  const firstLine = stackLines[0] || validError.message || "";
  const colonIndex = firstLine.indexOf(":");
  let errorName = "[ERROR]";
  let errorMessage = firstLine;

  if (colonIndex !== -1) {
    errorMessage = firstLine.trim();
  }
  const remainingStack = stackLines.slice(1).join("\n");
  let output = `${errorPalette.label.text(errorName)} ${errorMessage}`;

  if (remainingStack) {
    output += `\n${errorPalette.muted.text(remainingStack)}`;
  }

  console.log(output);
}

class Logger {
  constructor(pre = "") {
    this.pre = pre;
  }
  errorWithTrace = displayError;
  format(level, style, message) {
    const messageStyle = level === "debug" ? loggerPalette.debugText : loggerPalette.text;

    const label = style.text(`[${level.toUpperCase()}]`);
    return `${this.pre ? `${this.pre} ` : ""}${label} ${messageStyle.text(message)}`;
  }

  prefix(prefix) {
    return new Logger(`${this.pre ? `${this.pre} ` : ""}${prefix}`);
  }

  info(message) {
    console.log(this.format("info", loggerPalette.info, message));
  }

  warn(message) {
    console.log(this.format("warn", loggerPalette.warn, message));
  }

  error(message) {
    console.log(this.format("error", loggerPalette.error, message));
  }

  success(message) {
    console.log(this.format("success", loggerPalette.success, message));
  }

  debug(message) {
    console.log(this.format("debug", loggerPalette.debugTag, message));
  }

  log(message) {
    console.log(loggerPalette.text.text(message));
  }

  meta(message) {
    console.log(this.format("meta", loggerPalette.meta, message));
  }
}

export default Logger;
