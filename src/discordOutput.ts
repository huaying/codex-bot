import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";

const MESSAGE_LIMIT = 1900;
const INLINE_TOTAL_LIMIT = 7600;

export function trimForDiscord(text: string, max = MESSAGE_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function formatCodeBlock(text: string): string {
  const safe = text.replaceAll("```", "`\u200b``");
  return `\`\`\`\n${safe}\n\`\`\``;
}

export async function sendLongResult(
  interaction: ChatInputCommandInteraction,
  header: string,
  body: string,
): Promise<void> {
  const cleanBody = body.trim() || "(no final message)";
  if ((header.length + cleanBody.length) <= MESSAGE_LIMIT - 16) {
    await safeEditReply(interaction, `${header}\n\n${cleanBody}`);
    return;
  }

  if (cleanBody.length <= INLINE_TOTAL_LIMIT) {
    const chunks = splitText(cleanBody, MESSAGE_LIMIT - 64);
    await safeEditReply(interaction, `${header}\n\n${chunks[0]}`);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk });
    }
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(cleanBody, "utf8"), {
    name: "codex-output.txt",
  });
  await safeEditReply(interaction, {
    content: `${header}\n\nOutput was too long for Discord; attached as text.`,
    files: [attachment],
  });
}

export async function sendLongMessage(
  message: Message,
  header: string,
  body: string,
): Promise<void> {
  const cleanBody = body.trim() || "(no final message)";
  const firstContent = formatWithOptionalHeader(header, cleanBody);
  if (firstContent.length <= MESSAGE_LIMIT) {
    await message.reply(firstContent);
    return;
  }

  if (cleanBody.length <= INLINE_TOTAL_LIMIT) {
    const chunks = splitText(cleanBody, MESSAGE_LIMIT - 64);
    await message.reply(formatWithOptionalHeader(header, chunks[0]));
    for (const chunk of chunks.slice(1)) {
      await (message.channel as SendableChannel).send(chunk);
    }
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(cleanBody, "utf8"), {
    name: "codex-output.txt",
  });
  await message.reply({
    content: formatWithOptionalHeader(header, "Output was too long for Discord; attached as text."),
    files: [attachment],
  });
}

export async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  payload: string | { content: string; files?: AttachmentBuilder[] },
): Promise<void> {
  try {
    await interaction.editReply(payload);
    return;
  } catch {
    const channel = interaction.channel;
    if (channel && "send" in channel) {
      await (channel as SendableChannel).send(payload);
    }
  }
}

interface SendableChannel {
  send(payload: string | { content: string; files?: AttachmentBuilder[] }): Promise<unknown>;
}

function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const idx = Math.max(rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max));
    const cut = idx > max * 0.5 ? idx : max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function formatWithOptionalHeader(header: string, body: string): string {
  const cleanHeader = header.trim();
  return cleanHeader ? `${cleanHeader}\n\n${body}` : body;
}
