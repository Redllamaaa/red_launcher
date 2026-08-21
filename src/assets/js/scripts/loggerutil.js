/**
 * Rust-backed logging via tauri-plugin-log.
 */
import {
  trace as logTrace,
  debug as logDebug,
  info as logInfo,
  warn as logWarn,
  error as logError,
  attachConsole,
} from "@tauri-apps/plugin-log";

// Mirrors Rust-side logs into the webview devtools console.
// Safe to call once; call it as early as possible in your app entry point.
export async function initLogging() {
  await attachConsole();
}

function formatArgs(args) {
  return args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
}

export const LoggerUtil = {
  getLogger: (name) => ({
    trace: (...args) => logTrace(`[${name}] ${formatArgs(args)}`),
    debug: (...args) => logDebug(`[${name}] ${formatArgs(args)}`),
    info: (...args) => logInfo(`[${name}] ${formatArgs(args)}`),
    warn: (...args) => logWarn(`[${name}] ${formatArgs(args)}`),
    error: (...args) => logError(`[${name}] ${formatArgs(args)}`),
  }),
};
