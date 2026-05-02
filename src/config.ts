import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig, LogLevel, WorkspaceConfig } from "./types.js";

loadDotenv({ override: true, quiet: true });

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional().default(""),
  ALLOWED_USER_IDS: z.string().optional().default(""),
  ALLOWED_GUILD_IDS: z.string().optional().default(""),
  ALLOWED_CHANNEL_IDS: z.string().optional().default(""),
  WORKSPACES: z.string().optional().default(""),
  WORKSPACE_ROOTS: z.string().optional().default(""),
  DEFAULT_WORKSPACE_ID: z.string().optional().default(""),
  CODEX_COMMAND: z.string().optional().default("codex"),
  CODEX_SANDBOX: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional().default("workspace-write"),
  CODEX_FULL_AUTO: z.string().optional().default("true"),
  CODEX_YOLO: z.string().optional().default("false"),
  CODEX_MODEL: z.string().optional().default(""),
  CODEX_PROFILE: z.string().optional().default(""),
  CODEX_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional().default(840),
  CODEX_EXTRA_ARGS_JSON: z.string().optional().default("[]"),
  AUTO_REGISTER_COMMANDS: z.string().optional().default("true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
  DATA_DIR: z.string().optional().default(".data"),
  ENABLE_MESSAGE_SESSIONS: z.string().optional().default("true"),
  ENABLE_DM_POLLING: z.string().optional().default("false"),
  DM_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().optional().default(3),
  CONTINUE_GUILD_CHANNEL_SESSIONS: z.string().optional().default("false"),
});

export function loadConfig(): AppConfig {
  const raw = envSchema.parse(process.env);
  const workspaceRoots = parseWorkspaceRoots(raw.WORKSPACE_ROOTS);
  const workspaces = loadWorkspaces(raw.WORKSPACES, workspaceRoots);
  const defaultWorkspaceId = raw.DEFAULT_WORKSPACE_ID || firstWorkspaceId(workspaces);

  if (!workspaces.has(defaultWorkspaceId)) {
    throw new Error(`DEFAULT_WORKSPACE_ID '${defaultWorkspaceId}' is not in configured workspaces`);
  }

  const codexExtraArgs = parseExtraArgs(raw.CODEX_EXTRA_ARGS_JSON);
  const codexFullAuto = parseBool(raw.CODEX_FULL_AUTO, true);
  const codexYolo = parseBool(raw.CODEX_YOLO, false);

  if (codexYolo && codexFullAuto) {
    throw new Error("Refusing CODEX_YOLO=true with CODEX_FULL_AUTO=true; set CODEX_FULL_AUTO=false");
  }

  if (!codexYolo && raw.CODEX_SANDBOX === "danger-full-access" && codexFullAuto) {
    throw new Error("Refusing CODEX_FULL_AUTO=true with CODEX_SANDBOX=danger-full-access");
  }

  return {
    discordToken: raw.DISCORD_TOKEN,
    discordClientId: raw.DISCORD_CLIENT_ID,
    discordGuildId: emptyToUndefined(raw.DISCORD_GUILD_ID),
    allowedUserIds: parseCsvSet(raw.ALLOWED_USER_IDS),
    allowedGuildIds: parseCsvSet(raw.ALLOWED_GUILD_IDS),
    allowedChannelIds: parseCsvSet(raw.ALLOWED_CHANNEL_IDS),
    workspaces,
    workspaceRoots,
    defaultWorkspaceId,
    codexCommand: raw.CODEX_COMMAND,
    codexSandbox: raw.CODEX_SANDBOX,
    codexFullAuto,
    codexYolo,
    codexModel: emptyToUndefined(raw.CODEX_MODEL),
    codexProfile: emptyToUndefined(raw.CODEX_PROFILE),
    codexTimeoutMs: raw.CODEX_TIMEOUT_SECONDS * 1000,
    codexExtraArgs,
    autoRegisterCommands: parseBool(raw.AUTO_REGISTER_COMMANDS, true),
    logLevel: raw.LOG_LEVEL as LogLevel,
    dataDir: path.resolve(expandHome(raw.DATA_DIR)),
    enableMessageSessions: parseBool(raw.ENABLE_MESSAGE_SESSIONS, true),
    enableDmPolling: parseBool(raw.ENABLE_DM_POLLING, false),
    dmPollIntervalMs: raw.DM_POLL_INTERVAL_SECONDS * 1000,
    continueGuildChannelSessions: parseBool(raw.CONTINUE_GUILD_CHANNEL_SESSIONS, false),
  };
}

function loadWorkspaces(workspacesValue: string, workspaceRoots: string[]): Map<string, WorkspaceConfig> {
  const map = parseWorkspaces(workspacesValue);
  for (const root of workspaceRoots) {
    for (const workspace of discoverWorkspaceRoot(root)) {
      if (!map.has(workspace.id)) {
        map.set(workspace.id, workspace);
      }
    }
  }
  if (map.size === 0) {
    throw new Error("Configure at least one workspace via WORKSPACES or WORKSPACE_ROOTS");
  }
  return map;
}

function parseWorkspaces(value: string): Map<string, WorkspaceConfig> {
  const map = new Map<string, WorkspaceConfig>();
  for (const item of value.split(";")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) {
      throw new Error(`Invalid WORKSPACES entry '${trimmed}'. Expected id:/absolute/path`);
    }
    const id = trimmed.slice(0, sep).trim();
    const rawPath = trimmed.slice(sep + 1).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workspace id '${id}'. Use letters, numbers, '_' or '-'`);
    }
    const resolved = path.resolve(expandHome(rawPath));
    map.set(id, { id, path: resolved });
  }
  return map;
}

function parseWorkspaceRoots(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((root) => path.resolve(expandHome(root)));
}

function discoverWorkspaceRoot(root: string): WorkspaceConfig[] {
  const rootRealPath = realPathOrNull(root);
  if (!rootRealPath) return [];

  const entries = fs.readdirSync(rootRealPath, { withFileTypes: true });
  const workspaces: WorkspaceConfig[] = [];
  const usedIds = new Set<string>();

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "dist", "build"].includes(entry.name)) continue;

    const candidatePath = path.join(rootRealPath, entry.name);
    const candidateRealPath = realPathOrNull(candidatePath);
    if (!candidateRealPath) continue;
    if (!isPathInside(candidateRealPath, rootRealPath)) continue;

    const id = uniqueWorkspaceId(toWorkspaceId(entry.name), usedIds);
    if (!id) continue;
    workspaces.push({ id, path: candidateRealPath });
  }

  return workspaces;
}

function realPathOrNull(value: string): string | null {
  try {
    const realPath = fs.realpathSync.native(value);
    return fs.statSync(realPath).isDirectory() ? realPath : null;
  } catch {
    return null;
  }
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toWorkspaceId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueWorkspaceId(baseId: string, usedIds: Set<string>): string | null {
  if (!baseId) return null;
  let id = baseId;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  usedIds.add(id);
  return id;
}

function parseExtraArgs(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("CODEX_EXTRA_ARGS_JSON must be a JSON array of strings");
  }
  validateExtraArgs(parsed);
  return parsed;
}

function validateExtraArgs(args: string[]): void {
  const bannedExact = new Set([
    "-c",
    "-s",
    "--config",
    "--sandbox",
    "--full-auto",
    "--dangerously-bypass-approvals-and-sandbox",
    "--yolo",
  ]);
  const bannedPrefixes = [
    "-c=",
    "--config=",
    "-s=",
    "--sandbox=",
    "--dangerously-",
  ];

  for (const arg of args) {
    if (bannedExact.has(arg) || bannedPrefixes.some((prefix) => arg.startsWith(prefix))) {
      throw new Error(`Refusing unsafe CODEX_EXTRA_ARGS_JSON entry: ${arg}`);
    }
  }
}

function parseCsvSet(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function parseBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function firstWorkspaceId(workspaces: Map<string, WorkspaceConfig>): string {
  const first = workspaces.keys().next().value;
  if (!first) throw new Error("No workspaces configured");
  return first;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function expandHome(value: string): string {
  if (value === "~") return process.env.HOME ?? value;
  if (value.startsWith("~/")) return path.join(process.env.HOME ?? "", value.slice(2));
  return value;
}
