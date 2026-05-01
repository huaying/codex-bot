import type { LogLevel } from "./types.js";

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(level: LogLevel, message: string, meta?: unknown): void {
  if (rank[level] < rank[currentLevel]) return;
  const ts = new Date().toISOString();
  const suffix = meta === undefined ? "" : ` ${safeStringify(meta)}`;
  process.stderr.write(`[${ts}] [${level}] ${message}${suffix}\n`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
