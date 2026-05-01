import { loadConfig } from "./config.js";
import { setLogLevel, log } from "./logger.js";
import { CodexDiscordBot } from "./bot.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  log("info", "starting codex discord bridge", {
    workspaces: [...config.workspaces.keys()],
    defaultWorkspaceId: config.defaultWorkspaceId,
    sandbox: config.codexSandbox,
    fullAuto: config.codexFullAuto,
  });

  const bot = new CodexDiscordBot(config);
  await bot.start();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
