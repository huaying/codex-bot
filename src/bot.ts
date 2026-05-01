import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, CodexRunResult, SessionRecord, WorkspaceConfig } from "./types.js";
import { assertAuthorized } from "./auth.js";
import { JobManager } from "./jobManager.js";
import {
  formatCodeBlock,
  safeEditReply,
  sendLongMessage,
  sendLongResult,
  trimForDiscord,
} from "./discordOutput.js";
import { log } from "./logger.js";
import { registerCommands } from "./commands.js";
import { SessionStore } from "./sessionStore.js";

interface QueuedPrompt {
  message: Message;
  prompt: string;
  routeKey: string;
}

export class CodexDiscordBot {
  private readonly client: Client;
  private readonly jobs: JobManager;
  private readonly sessions: SessionStore;
  private readonly messageQueues = new Map<string, QueuedPrompt[]>();
  private readonly activeMessageRoutes = new Set<string>();
  private readonly seenMessageIds = new Set<string>();
  private readonly startedAt = Date.now();
  private isPollingDms = false;
  private dmPollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {
    this.client = new Client({
      intents: config.enableMessageSessions
        ? [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
          ]
        : [GatewayIntentBits.Guilds],
      partials: [Partials.Channel, Partials.Message],
    });
    this.jobs = new JobManager(config);
    this.sessions = new SessionStore(config.dataDir);
    this.registerHandlers();
  }

  async start(): Promise<void> {
    await this.sessions.load();
    if (this.config.autoRegisterCommands) {
      await registerCommands(this.config);
    }
    await this.client.login(this.config.discordToken);
  }

  private registerHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      log("info", `discord bot ready: ${client.user.tag} (${client.user.id})`);
      if (this.config.enableMessageSessions) {
        this.catchUpRecentDms().catch((error) => {
          log("error", "failed to catch up recent DMs", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        if (this.config.enableDmPolling) {
          this.startDmPolling().catch((error) => {
            log("error", "failed to start DM polling", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== "codex") return;

      const authError = assertAuthorized(this.config, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      if (authError) {
        await interaction.reply({ content: authError, ephemeral: true });
        return;
      }

      try {
        await this.handleCodex(interaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "interaction failed", { message });
        if (interaction.deferred || interaction.replied) {
          await safeEditReply(interaction, `Error: ${trimForDiscord(message)}`);
        } else {
          await interaction.reply({ content: `Error: ${trimForDiscord(message)}`, ephemeral: true });
        }
      }
    });

    if (this.config.enableMessageSessions) {
      this.client.on(Events.Raw, (packet) => {
        if (packet.t !== "MESSAGE_CREATE") return;
        const data = packet.d as {
          id?: string;
          channel_id?: string;
          guild_id?: string;
          author?: { id?: string; bot?: boolean };
          content?: string;
        };
        log("debug", "gateway MESSAGE_CREATE", {
          messageId: data.id,
          channelId: data.channel_id,
          guildId: data.guild_id ?? null,
          authorId: data.author?.id,
          authorBot: data.author?.bot ?? false,
          contentLength: data.content?.length ?? 0,
        });
      });

      this.client.on(Events.MessageCreate, async (message) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log("error", "message handling failed", { msg });
          await message.reply(`Error: ${trimForDiscord(msg)}`).catch(() => {});
        }
      });
    }

    this.client.on(Events.Error, (error) => {
      log("error", `discord client error: ${error.message}`);
    });
  }

  private async handleCodex(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "ask":
        await this.handleAsk(interaction);
        break;
      case "cancel":
        await this.handleCancel(interaction);
        break;
      case "new":
        await this.handleNew(interaction);
        break;
      case "close":
        await this.handleClose(interaction);
        break;
      case "status":
        await this.handleStatus(interaction);
        break;
      case "workspace":
        await this.handleWorkspace(interaction);
        break;
      case "workspaces":
        await this.handleWorkspaces(interaction);
        break;
      default:
        await interaction.reply({ content: `Unknown subcommand: ${subcommand}`, ephemeral: true });
    }
  }

  private async handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;
    const routeKey = routeKeyForInteraction(interaction);
    const prompt = interaction.options.getString("prompt", true);
    const explicitWorkspaceId = interaction.options.getString("workspace") ?? undefined;
    const existing = this.sessions.get(routeKey);
    const workspace = this.workspaceFor(routeKey, existing, explicitWorkspaceId);
    const resumeSessionId =
      explicitWorkspaceId && existing?.workspaceId !== explicitWorkspaceId
        ? undefined
        : existing?.sessionId;

    await interaction.deferReply();
    const snapshot = this.jobs.start({
      prompt,
      workspace,
      requestedBy: interaction.user.id,
      channelId,
      resumeSessionId,
    });

    await safeEditReply(
      interaction,
      [
        `Codex started: \`${snapshot.id}\``,
        `Workspace: \`${snapshot.workspaceId}\``,
        resumeSessionId ? `Session: \`${resumeSessionId}\`` : "Session: new",
        `Prompt: ${trimForDiscord(snapshot.promptPreview, 500)}`,
      ].join("\n"),
    );

    const progress = setInterval(() => {
      const elapsed = Math.floor((Date.now() - snapshot.startedAt) / 1000);
      safeEditReply(
        interaction,
        [
          `Codex running: \`${snapshot.id}\` (${elapsed}s)`,
          `Workspace: \`${snapshot.workspaceId}\``,
          `Prompt: ${trimForDiscord(snapshot.promptPreview, 500)}`,
          "Use `/codex cancel` in this channel to stop it.",
        ].join("\n"),
      ).catch(() => {});
    }, 15_000);

    try {
      const result = await this.jobs.resultFor(channelId);
      if (!result) {
        await safeEditReply(interaction, "Codex job disappeared before completion.");
        return;
      }
      await this.persistSessionFromResult({
        routeKey,
        result,
        workspace,
        channelId,
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
        prompt,
      });
      await this.renderInteractionResult(interaction, result);
    } finally {
      clearInterval(progress);
    }
  }

  private async handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    const cancelled = this.jobs.cancel(interaction.channelId);
    await interaction.reply({
      content: cancelled ? "Cancel signal sent." : "No running Codex job in this channel.",
      ephemeral: true,
    });
  }

  private async handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
    const routeKey = routeKeyForInteraction(interaction);
    const deleted = await this.sessions.delete(routeKey);
    await interaction.reply({
      content: deleted
        ? "Session cleared. The next message starts a fresh Codex session."
        : "No saved session for this Discord conversation.",
      ephemeral: true,
    });
  }

  private async handleClose(interaction: ChatInputCommandInteraction): Promise<void> {
    const routeKey = routeKeyForInteraction(interaction);
    const deleted = await this.sessions.delete(routeKey);
    const cancelled = this.jobs.cancel(interaction.channelId);
    await interaction.reply({
      content: [
        deleted ? "Saved session removed." : "No saved session for this Discord conversation.",
        cancelled ? "Running job was cancelled." : "No running job in this channel.",
      ].join(" "),
      ephemeral: true,
    });
  }

  private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const jobs = this.jobs.status();
    const routeKey = routeKeyForInteraction(interaction);
    const session = this.sessions.get(routeKey);
    const workspace = this.workspaceFor(routeKey, session);

    const lines: string[] = [];
    if (session) {
      lines.push(`Current session: \`${session.sessionId}\` workspace=\`${session.workspaceId}\``);
    } else {
      lines.push("Current session: none");
    }
    lines.push(`Current workspace: \`${workspace.id}\` ${workspace.path}`);

    if (jobs.length > 0) {
      lines.push("");
      lines.push("Running jobs:");
      for (const job of jobs) {
        const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);
        lines.push(
          `\`${job.id}\` workspace=\`${job.workspaceId}\` channel=\`${job.channelId}\` elapsed=${elapsed}s prompt=${trimForDiscord(job.promptPreview, 120)}`,
        );
      }
    }

    await interaction.reply({ content: trimForDiscord(lines.join("\n")), ephemeral: true });
  }

  private async handleWorkspace(interaction: ChatInputCommandInteraction): Promise<void> {
    const routeKey = routeKeyForInteraction(interaction);
    const workspaceId = interaction.options.getString("id") ?? undefined;
    if (!workspaceId) {
      const session = this.sessions.get(routeKey);
      const workspace = this.workspaceFor(routeKey, session);
      await interaction.reply({
        content: `Current workspace: \`${workspace.id}\` ${workspace.path}`,
        ephemeral: true,
      });
      return;
    }

    const result = await this.switchRouteWorkspace({
      routeKey,
      workspaceId,
      channelId: interaction.channelId,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    });
    await interaction.reply({ content: result, ephemeral: true });
  }

  private async handleWorkspaces(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ content: trimForDiscord(this.formatWorkspaces()), ephemeral: true });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (this.seenMessageIds.has(message.id)) return;
    this.seenMessageIds.add(message.id);
    if (message.author.bot) {
      log("debug", "ignored bot message", {
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author.id,
      });
      return;
    }
    if (message.author.id === this.client.user?.id) {
      log("debug", "ignored self message", {
        channelId: message.channelId,
        guildId: message.guildId,
      });
      return;
    }

    const isDm = !message.guildId;
    const mentioned = this.client.user ? message.mentions.users.has(this.client.user.id) : false;
    log("debug", "discord.js MessageCreate", {
      channelId: message.channelId,
      guildId: message.guildId,
      authorId: message.author.id,
      isDm,
      mentioned,
      contentLength: message.content.length,
    });

    const authError = assertAuthorized(this.config, {
      userId: message.author.id,
      guildId: message.guildId,
      channelId: message.channelId,
    });

    const routeKey = routeKeyForMessage(message);
    const existing = this.sessions.get(routeKey);
    const canContinueGuild = this.config.continueGuildChannelSessions && Boolean(existing);
    const canStartGuild = this.config.continueGuildChannelSessions && this.isAllowedGuild(message.guildId);

    if (!isDm && !mentioned && !canContinueGuild && !canStartGuild) {
      log("debug", "ignored guild message without mention", {
        routeKey,
        channelId: message.channelId,
        guildId: message.guildId,
      });
      return;
    }

    if (authError) {
      log("warn", "rejected unauthorized message", {
        routeKey,
        channelId: message.channelId,
        guildId: message.guildId,
        userId: message.author.id,
      });
      await message.reply(authError);
      return;
    }

    let text = message.content.trim();
    if (mentioned && this.client.user) {
      text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "").trim();
    }
    if (!text) {
      log("debug", "ignored empty message prompt", {
        routeKey,
        channelId: message.channelId,
        guildId: message.guildId,
      });
      await message.reply("Send a prompt after mentioning me, or DM me directly.");
      return;
    }

    if (await this.handleMessageControl(routeKey, message, text)) return;

    log("info", "accepted message prompt", {
      routeKey,
      channelId: message.channelId,
      guildId: message.guildId,
      userId: message.author.id,
      resume: Boolean(existing?.sessionId),
    });
    this.enqueueMessagePrompt({ message, prompt: text, routeKey });
  }

  private isAllowedGuild(guildId: string | null): boolean {
    if (!guildId) return false;
    return this.config.allowedGuildIds.size === 0 || this.config.allowedGuildIds.has(guildId);
  }

  private async startDmPolling(): Promise<void> {
    const users = [...this.config.allowedUserIds];
    if (users.length === 0) return;

    if (this.dmPollTimer) {
      clearInterval(this.dmPollTimer);
      this.dmPollTimer = null;
    }

    const dmChannels = new Map<string, string>();
    let seededSeen = 0;
    let pendingRecent = 0;
    for (const userId of users) {
      const user = await this.client.users.fetch(userId);
      const channel = await user.createDM();
      dmChannels.set(userId, channel.id);

      const latest = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      for (const message of latest?.values() ?? []) {
        if (message.author.bot || message.createdTimestamp < this.startedAt - 5000) {
          if (!this.seenMessageIds.has(message.id)) {
            this.seenMessageIds.add(message.id);
            seededSeen += 1;
          }
        } else {
          pendingRecent += 1;
        }
      }
    }

    log("info", "DM polling enabled", {
      users: users.length,
      channels: dmChannels.size,
      intervalMs: this.config.dmPollIntervalMs,
      seededSeen,
      pendingRecent,
    });

    await this.pollDmChannels(dmChannels);

    this.dmPollTimer = setInterval(() => {
      this.pollDmChannels(dmChannels).catch((error) => {
        log("warn", "DM polling tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.dmPollIntervalMs);
    this.dmPollTimer.unref();
  }

  private async catchUpRecentDms(): Promise<void> {
    const users = [...this.config.allowedUserIds];
    if (users.length === 0) return;

    const recentMessages: Message[] = [];
    for (const userId of users) {
      const user = await this.client.users.fetch(userId);
      const channel = await user.createDM();
      const latest = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      for (const message of latest?.values() ?? []) {
        if (this.seenMessageIds.has(message.id)) continue;
        if (message.author.bot) continue;
        if (message.createdTimestamp < this.startedAt - 5000) continue;
        recentMessages.push(message);
      }
    }

    recentMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    if (recentMessages.length > 0) {
      log("info", "catching up recent DMs", {
        count: recentMessages.length,
      });
    }
    for (const message of recentMessages) {
      await this.handleMessage(message);
    }
  }

  private async pollDmChannels(dmChannels: Map<string, string>): Promise<void> {
    if (this.isPollingDms) return;
    this.isPollingDms = true;
    try {
      for (const channelId of dmChannels.values()) {
        const channel = await this.client.channels.fetch(channelId);
        if (!channel || !("messages" in channel)) continue;
        const messages = await channel.messages.fetch({ limit: 10 });
        const unseen = [...messages.values()]
          .filter((message) => !this.seenMessageIds.has(message.id))
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        if (unseen.length > 0) {
          log("info", "DM polling found unseen messages", {
            channelId,
            count: unseen.length,
          });
        }
        for (const message of unseen) {
          await this.handleMessage(message);
        }
      }
    } finally {
      this.isPollingDms = false;
    }
  }

  private async handleMessageControl(
    routeKey: string,
    message: Message,
    text: string,
  ): Promise<boolean> {
    const normalized = text.trim();
    if (normalized === "/workspaces") {
      await message.reply(trimForDiscord(this.formatWorkspaces()));
      return true;
    }
    if (normalized === "/workspace" || normalized === "/use") {
      const session = this.sessions.get(routeKey);
      const workspace = this.workspaceFor(routeKey, session);
      await message.reply(`Current workspace: \`${workspace.id}\` ${workspace.path}`);
      return true;
    }
    if (normalized.startsWith("/workspace ") || normalized.startsWith("/use ")) {
      const workspaceId = normalized.split(/\s+/)[1];
      const result = await this.switchRouteWorkspace({
        routeKey,
        workspaceId,
        channelId: message.channelId,
        guildId: message.guildId ?? undefined,
        userId: message.author.id,
      });
      await message.reply(result);
      return true;
    }
    if (normalized === "/new") {
      await this.sessions.delete(routeKey);
      await message.reply("Session cleared. Your next message starts a fresh Codex session.");
      return true;
    }
    if (normalized === "/close") {
      const deleted = await this.sessions.delete(routeKey);
      const cancelled = this.jobs.cancel(message.channelId);
      await message.reply([
        deleted ? "Saved session removed." : "No saved session here.",
        cancelled ? "Running job cancelled." : "",
      ].filter(Boolean).join(" "));
      return true;
    }
    if (normalized === "/status") {
      const session = this.sessions.get(routeKey);
      const workspace = this.workspaceFor(routeKey, session);
      await message.reply(
        session
          ? `Session: \`${session.sessionId}\`\nWorkspace: \`${session.workspaceId}\``
          : `No saved session here.\nWorkspace: \`${workspace.id}\` ${workspace.path}`,
      );
      return true;
    }
    return false;
  }

  private enqueueMessagePrompt(prompt: QueuedPrompt): void {
    const queue = this.messageQueues.get(prompt.routeKey) ?? [];
    queue.push(prompt);
    this.messageQueues.set(prompt.routeKey, queue);

    if (queue.length > 1 || this.activeMessageRoutes.has(prompt.routeKey)) {
      prompt.message.reply(`Queued message #${queue.length}.`).catch(() => {});
    }

    if (!this.activeMessageRoutes.has(prompt.routeKey)) {
      this.processMessageQueue(prompt.routeKey).catch((error) => {
        log("error", "message queue failed", {
          routeKey: prompt.routeKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async processMessageQueue(routeKey: string): Promise<void> {
    this.activeMessageRoutes.add(routeKey);
    try {
      while (true) {
        const queue = this.messageQueues.get(routeKey) ?? [];
        const next = queue.shift();
        if (!next) {
          this.messageQueues.delete(routeKey);
          return;
        }
        this.messageQueues.set(routeKey, queue);
        try {
          await this.runMessagePrompt(next);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log("error", "message prompt failed", { routeKey, message });
          await next.message.reply(`Error: ${trimForDiscord(message)}`).catch(() => {});
        }
      }
    } finally {
      this.activeMessageRoutes.delete(routeKey);
    }
  }

  private async runMessagePrompt(next: QueuedPrompt): Promise<void> {
    const existing = this.sessions.get(next.routeKey);
    const workspace = this.workspaceFor(next.routeKey, existing);
    const channel = next.message.channel;
    if ("sendTyping" in channel) {
      await channel.sendTyping().catch(() => {});
    }

    const snapshot = this.jobs.start({
      prompt: next.prompt,
      workspace,
      requestedBy: next.message.author.id,
      channelId: next.message.channelId,
      resumeSessionId: existing?.sessionId,
    });

    const typing = setInterval(() => {
      if ("sendTyping" in channel) channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      const result = await this.jobs.resultFor(next.message.channelId);
      if (!result) {
        await next.message.reply("Codex job disappeared before completion.");
        return;
      }
      await this.persistSessionFromResult({
        routeKey: next.routeKey,
        result,
        workspace,
        channelId: next.message.channelId,
        guildId: next.message.guildId ?? undefined,
        userId: next.message.author.id,
        prompt: next.prompt,
      });
      await this.renderMessageResult(next.message, result, snapshot.id);
    } finally {
      clearInterval(typing);
    }
  }

  private workspaceFor(routeKey: string, existing?: SessionRecord, explicitWorkspaceId?: string): WorkspaceConfig {
    const workspaceId =
      explicitWorkspaceId ??
      existing?.workspaceId ??
      this.sessions.getWorkspacePreference(routeKey)?.workspaceId ??
      this.config.defaultWorkspaceId;
    const workspace = this.resolveWorkspace(workspaceId);
    if (workspace) return workspace;
    if (explicitWorkspaceId) {
      throw new Error(`Unknown workspace: ${explicitWorkspaceId}`);
    }
    return this.config.workspaces.get(this.config.defaultWorkspaceId)!;
  }

  private async switchRouteWorkspace(input: {
    routeKey: string;
    workspaceId: string;
    channelId: string;
    guildId?: string;
    userId: string;
  }): Promise<string> {
    const workspace = this.resolveWorkspace(input.workspaceId);
    if (!workspace) {
      return [
        `Unknown workspace: \`${input.workspaceId}\``,
        "",
        this.formatWorkspaces(),
        this.config.workspaceRoots.length > 0
          ? "\nNested relative paths under WORKSPACE_ROOTS are allowed, for example `/use thoth/athena`."
          : "",
      ].join("\n");
    }

    const cancelled = this.jobs.cancel(input.channelId);
    const deleted = await this.sessions.delete(input.routeKey);
    await this.sessions.setWorkspacePreference({
      routeKey: input.routeKey,
      workspaceId: workspace.id,
      channelId: input.channelId,
      guildId: input.guildId,
      userId: input.userId,
      updatedAt: Date.now(),
    });

    const notes = [
      `Workspace switched to \`${workspace.id}\`: ${workspace.path}`,
      deleted ? "Previous Codex session cleared." : "",
      cancelled ? "Running job cancelled." : "",
      "Next prompt starts a fresh Codex session in this workspace.",
    ].filter(Boolean);
    return trimForDiscord(notes.join("\n"));
  }

  private formatWorkspaces(): string {
    return [...this.config.workspaces.values()]
      .map((workspace) => {
        const marker = workspace.id === this.config.defaultWorkspaceId ? " default" : "";
        return `\`${workspace.id}\`${marker}: ${workspace.path}`;
      })
      .join("\n");
  }

  private resolveWorkspace(value: string): WorkspaceConfig | undefined {
    const trimmed = value.trim();
    const configured = this.config.workspaces.get(trimmed);
    if (configured) return configured;
    return this.resolveNestedWorkspace(trimmed);
  }

  private resolveNestedWorkspace(value: string): WorkspaceConfig | undefined {
    const relativePath = safeRelativeWorkspacePath(value);
    if (!relativePath) return undefined;

    for (const root of this.config.workspaceRoots) {
      const rootRealPath = realDirectoryPath(root);
      if (!rootRealPath) continue;
      const candidateRealPath = realDirectoryPath(path.join(rootRealPath, relativePath));
      if (!candidateRealPath) continue;
      if (!isPathInside(candidateRealPath, rootRealPath)) continue;
      return {
        id: relativePath.split(path.sep).join("/"),
        path: candidateRealPath,
      };
    }
    return undefined;
  }

  private async persistSessionFromResult(input: {
    routeKey: string;
    result: CodexRunResult;
    workspace: WorkspaceConfig;
    channelId: string;
    guildId?: string;
    userId: string;
    prompt: string;
  }): Promise<void> {
    if (!input.result.sessionId) return;
    const now = Date.now();
    const existing = this.sessions.get(input.routeKey);
    await this.sessions.upsert({
      routeKey: input.routeKey,
      sessionId: input.result.sessionId,
      workspaceId: input.workspace.id,
      channelId: input.channelId,
      guildId: input.guildId,
      userId: input.userId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastPromptPreview: preview(input.prompt),
    });
  }

  private async renderInteractionResult(
    interaction: ChatInputCommandInteraction,
    result: CodexRunResult,
  ): Promise<void> {
    const status = resultStatus(result);
    const stderr = resultOk(result) || !result.stderr
      ? ""
      : `\n\nstderr:\n${formatCodeBlock(trimForDiscord(result.stderr, 1200))}`;
    await sendLongResult(interaction, status, `${result.finalMessage}${stderr}`);
  }

  private async renderMessageResult(
    message: Message,
    result: CodexRunResult,
    jobId: string,
  ): Promise<void> {
    const status = resultOk(result)
      ? ""
      : `${resultStatus(result)} Job: \`${jobId}\``;
    const stderr = resultOk(result) || !result.stderr
      ? ""
      : `\n\nstderr:\n${formatCodeBlock(trimForDiscord(result.stderr, 1200))}`;
    await sendLongMessage(message, status, `${result.finalMessage}${stderr}`);
  }
}

function routeKeyForInteraction(interaction: ChatInputCommandInteraction): string {
  return interaction.guildId
    ? `guild:${interaction.guildId}:channel:${interaction.channelId}`
    : `dm:${interaction.channelId}`;
}

function routeKeyForMessage(message: Message): string {
  return message.guildId
    ? `guild:${message.guildId}:channel:${message.channelId}`
    : `dm:${message.channelId}`;
}

function resultStatus(result: CodexRunResult): string {
  const seconds = Math.round(result.durationMs / 1000);
  return resultOk(result)
    ? `Codex finished in ${seconds}s.`
    : `Codex stopped in ${seconds}s (exit=${result.exitCode ?? "null"}, signal=${result.signal ?? "null"}${result.timedOut ? ", timeout" : ""}).`;
}

function resultOk(result: CodexRunResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function safeRelativeWorkspacePath(value: string): string | null {
  if (!value || value.includes("\0")) return null;
  if (value.startsWith("~") || path.isAbsolute(value)) return null;

  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) return null;

  const parts = normalized.split(path.sep);
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts.some((part) => part.startsWith("."))) return null;
  if (parts.some((part) => ["node_modules", "dist", "build"].includes(part))) return null;

  return normalized;
}

function realDirectoryPath(value: string): string | null {
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

function preview(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
