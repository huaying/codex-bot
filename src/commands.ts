import {
  REST,
  Routes,
  SlashCommandBuilder,
  type APIApplicationCommand,
} from "discord.js";
import type { AppConfig } from "./types.js";
import { log } from "./logger.js";

export function buildCommands(config: AppConfig): ReturnType<SlashCommandBuilder["toJSON"]>[] {
  const codex = new SlashCommandBuilder()
    .setName("codex")
    .setDescription("Run local Codex from Discord")
    .addSubcommand((sub) =>
      sub
        .setName("ask")
        .setDescription("Send a prompt to local Codex")
        .addStringOption((option) =>
          option
            .setName("prompt")
            .setDescription("Instruction for Codex")
            .setRequired(true)
            .setMaxLength(6000),
        )
        .addStringOption((option) => {
          return option
            .setName("workspace")
            .setDescription("Workspace id, or relative path under WORKSPACE_ROOTS")
            .setRequired(false);
        }),
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel the running Codex job in this channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("new")
        .setDescription("Clear this Discord conversation's saved Codex session"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Clear the saved session and cancel any running job here"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show running Codex jobs"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("workspace")
        .setDescription("Show or switch this Discord conversation's workspace")
        .addStringOption((option) => {
          return option
            .setName("id")
            .setDescription("Workspace id, or relative path under WORKSPACE_ROOTS")
            .setRequired(false);
        }),
    )
    .addSubcommand((sub) =>
      sub
        .setName("workspaces")
        .setDescription("List allowed workspaces"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("restart")
        .setDescription("Start a replacement bot process, then stop this one")
        .addBooleanOption((option) =>
          option
            .setName("force")
            .setDescription("Restart even if Codex jobs are currently running")
            .setRequired(false),
        ),
    );

  return [codex.toJSON()];
}

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands(config);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  const scope = config.discordGuildId ? `guild ${config.discordGuildId}` : "global";
  log("info", `registering slash commands for ${scope}`);
  const result = await rest.put(route, { body: commands }) as APIApplicationCommand[];
  log("info", `registered ${result.length} slash command root(s)`);
}
