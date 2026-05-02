import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./types.js";

const READY_ENV = "CODEX_RESTART_READY_FILE";
const HANDOFF_ENV = "CODEX_RESTART_HANDOFF";
const READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

export interface ReplacementProcess {
  pid?: number;
  readyFile: string;
}

interface ReadySignal {
  pid?: number;
  readyAt?: number;
}

export async function markRestartReady(): Promise<void> {
  const readyFile = process.env[READY_ENV];
  if (!readyFile) return;

  delete process.env[READY_ENV];
  await fs.mkdir(path.dirname(readyFile), { recursive: true });
  const payload: ReadySignal = {
    pid: process.pid,
    readyAt: Date.now(),
  };
  await fs.writeFile(readyFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function startReplacementProcess(config: AppConfig): Promise<ReplacementProcess> {
  const restartDir = path.join(config.dataDir, "restarts");
  await fs.mkdir(restartDir, { recursive: true });
  const readyFile = path.join(restartDir, `${Date.now()}-${randomUUID()}.ready.json`);
  const args = [...process.execArgv, ...process.argv.slice(1)];

  if (args.length === 0) {
    throw new Error("Cannot restart: current process entrypoint is unknown");
  }

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      [READY_ENV]: readyFile,
      [HANDOFF_ENV]: "1",
    },
    stdio: "ignore",
  });
  child.unref();

  const ready = await Promise.race([
    waitForReadySignal(readyFile, READY_TIMEOUT_MS),
    waitForSpawnError(child),
  ]);

  if (!ready) {
    throw new Error(`Replacement process did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
  }

  return {
    pid: ready.pid ?? child.pid,
    readyFile,
  };
}

async function waitForReadySignal(filePath: string, timeoutMs: number): Promise<ReadySignal | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (raw.trim()) {
      return JSON.parse(raw) as ReadySignal;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return null;
}

function waitForSpawnError(child: ReturnType<typeof spawn>): Promise<never> {
  return new Promise((_, reject) => {
    child.once("error", reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
