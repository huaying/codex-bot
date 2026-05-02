import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, CodexRunRequest, CodexRunResult } from "./types.js";
import { log } from "./logger.js";

const STDERR_CAPTURE_LIMIT = 64 * 1024;
const STDOUT_FALLBACK_CAPTURE_LIMIT = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCORD_OUTPUT_GUIDANCE = `

Discord response formatting guidance:
- Format the final answer for Discord Markdown.
- Prefer concise plain text, bullets, numbered lists, and fenced code blocks.
- For diagrams, use ASCII diagrams in fenced \`\`\`text code blocks unless the user explicitly asks for Mermaid/source.
- Do not use unsupported render formats expecting Discord to render diagrams.
- Do not include @everyone, @here, or user/role mentions unless the user explicitly requests them.
`;

export interface RunningCodexProcess {
  id: string;
  startedAt: number;
  cancel: () => void;
  done: Promise<CodexRunResult>;
}

export function runCodex(config: AppConfig, request: CodexRunRequest): RunningCodexProcess {
  const id = randomUUID();
  const startedAt = Date.now();
  let child: ChildProcessWithoutNullStreams | null = null;
  let killedByTimeout = false;
  let cancelled = false;

  const done = (async (): Promise<CodexRunResult> => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discord-"));
    const outputPath = path.join(tmpDir, "last-message.txt");
    const args = buildCodexArgs(config, request.workspace.path, outputPath, request.resumeSessionId);
    log("info", "starting codex job", {
      id,
      workspace: request.workspace.id,
      channelId: request.channelId,
      requestedBy: request.requestedBy,
      args: args.filter((arg) => arg !== request.prompt),
    });

    const stderrCapture = new LimitedCapture(STDERR_CAPTURE_LIMIT);
    const stdoutCapture = new LimitedCapture(STDOUT_FALLBACK_CAPTURE_LIMIT);

    try {
      child = spawn(config.codexCommand, args, {
        cwd: request.workspace.path,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutCapture.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrCapture.push(chunk);
      });

      child.stdin.end(`${request.prompt}${DISCORD_OUTPUT_GUIDANCE}`);

      const timeout = setTimeout(() => {
        killedByTimeout = true;
        if (child) terminateChild(child);
      }, config.codexTimeoutMs);

      const { exitCode, signal } = await waitForChild(child);
      clearTimeout(timeout);

      const stdout = stdoutCapture.toString();
      const finalMessage = await readFinalMessage(outputPath, stdout);
      const stderr = stderrCapture.toString().trim();
      const sessionId =
        request.resumeSessionId ??
        extractSessionId(stdout) ??
        await findSessionIdFromHistory(request.prompt, startedAt);
      return {
        exitCode,
        signal,
        finalMessage,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut: killedByTimeout,
        sessionId,
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      log("info", "codex job finished", {
        id,
        durationMs: Date.now() - startedAt,
        cancelled,
        timedOut: killedByTimeout,
      });
    }
  })();

  return {
    id,
    startedAt,
    done,
    cancel: () => {
      cancelled = true;
      if (child) terminateChild(child);
    },
  };
}

function buildCodexArgs(
  config: AppConfig,
  workspacePath: string,
  outputPath: string,
  resumeSessionId?: string,
): string[] {
  const args = resumeSessionId
    ? ["exec", "resume", "--json"]
    : ["exec", "--json"];

  if (config.codexYolo) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (config.codexFullAuto) {
    args.push("--full-auto");
  }

  if (!resumeSessionId) {
    args.push("--cd", workspacePath);
    if (!config.codexYolo) args.push("--sandbox", config.codexSandbox);
  }

  args.push("--skip-git-repo-check", "--output-last-message", outputPath);

  if (config.codexModel) args.push("--model", config.codexModel);
  if (!resumeSessionId && config.codexProfile) args.push("--profile", config.codexProfile);
  args.push(...config.codexExtraArgs);
  if (resumeSessionId) args.push(resumeSessionId);
  args.push("-");
  return args;
}

function waitForChild(child: ChildProcessWithoutNullStreams): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 5000).unref();
}

async function readFinalMessage(outputPath: string, stdout: string): Promise<string> {
  const fromFile = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (fromFile.trim()) return fromFile.trim();

  const parsed = extractUsefulTextFromJsonl(stdout);
  return parsed.trim() || stdout.trim();
}

function extractUsefulTextFromJsonl(stdout: string): string {
  const pieces: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as unknown;
      const text = findText(event);
      if (text) pieces.push(text);
    } catch {
      continue;
    }
  }
  return pieces.join("\n").trim();
}

function findText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "text", "content", "final_message", "last_message"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  for (const child of Object.values(record)) {
    const found = findText(child);
    if (found) return found;
  }
  return null;
}

function extractSessionId(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as unknown;
      const direct = sessionIdFromEvent(event);
      if (direct) return direct;
    } catch {
      continue;
    }
  }
  return undefined;
}

function sessionIdFromEvent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;

  if (record.type === "session_meta") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (typeof payload?.id === "string" && UUID_RE.test(payload.id)) return payload.id;
  }

  if (record.type === "thread.started" && typeof record.thread_id === "string" && UUID_RE.test(record.thread_id)) {
    return record.thread_id;
  }

  for (const [key, child] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    if (
      typeof child === "string" &&
      (normalizedKey.includes("session") || normalizedKey.includes("thread")) &&
      UUID_RE.test(child)
    ) {
      return child;
    }
    const nested = sessionIdFromEvent(child);
    if (nested) return nested;
  }

  return undefined;
}

async function findSessionIdFromHistory(prompt: string, startedAt: number): Promise<string | undefined> {
  const home = process.env.HOME;
  if (!home) return undefined;

  const historyPath = path.join(home, ".codex", "history.jsonl");
  const raw = await fs.readFile(historyPath, "utf8").catch(() => "");
  if (!raw.trim()) return undefined;

  const minTsSeconds = Math.floor((startedAt - 30_000) / 1000);
  const lines = raw.trimEnd().split(/\r?\n/).reverse();
  for (const line of lines.slice(0, 200)) {
    try {
      const record = JSON.parse(line) as {
        session_id?: unknown;
        ts?: unknown;
        text?: unknown;
      };
      if (
        typeof record.session_id === "string" &&
        UUID_RE.test(record.session_id) &&
        typeof record.ts === "number" &&
        record.ts >= minTsSeconds &&
        record.text === prompt
      ) {
        return record.session_id;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

class LimitedCapture {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    if (this.bytes >= this.limit) {
      this.truncated = true;
      return;
    }

    const remaining = this.limit - this.bytes;
    const stored = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(stored);
    this.bytes += stored.byteLength;
    if (stored.byteLength < chunk.byteLength) {
      this.truncated = true;
    }
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString("utf8");
    if (!this.truncated) return text;
    return `${text}\n\n[output truncated after ${this.limit} bytes]`;
  }
}
