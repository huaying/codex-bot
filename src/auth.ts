import type { AppConfig } from "./types.js";

export function assertAuthorized(config: AppConfig, input: {
  userId: string;
  guildId: string | null;
  channelId: string | null;
}): string | null {
  if (config.allowedUserIds.size === 0) {
    return "Bot is not configured: ALLOWED_USER_IDS is empty.";
  }

  if (!config.allowedUserIds.has(input.userId)) {
    return "You are not allowed to use this bot.";
  }

  if (config.allowedGuildIds.size > 0) {
    if (input.guildId && !config.allowedGuildIds.has(input.guildId)) {
      return "This Discord server is not allowed.";
    }
  }

  if (config.allowedChannelIds.size > 0) {
    if (!input.channelId || !config.allowedChannelIds.has(input.channelId)) {
      return "This channel is not allowed.";
    }
  }

  return null;
}
