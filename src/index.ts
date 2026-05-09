import { loadConfig } from "./config.js";
import { setLogLevel, log } from "./logger.js";
import { CodexDiscordBot } from "./bot.js";

installFatalErrorHandlers();

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  log("info", "starting codex discord bridge", {
    workspaces: [...config.workspaces.keys()],
    defaultWorkspaceId: config.defaultWorkspaceId,
    sandbox: config.codexSandbox,
    fullAuto: config.codexFullAuto,
    yolo: config.codexYolo,
  });

  const bot = new CodexDiscordBot(config);
  await bot.start();
}

main().catch((error) => {
  exitAfterFatalError("startup failure", error);
});

function installFatalErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    exitAfterFatalError("uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    exitAfterFatalError("unhandled rejection", reason);
  });
}

function exitAfterFatalError(kind: string, error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  log("error", kind, { error: message });
  process.exit(1);
}
