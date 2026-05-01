import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";

const MESSAGE_LIMIT = 1900;
const INLINE_TOTAL_LIMIT = 7600;
const NO_MENTIONS = { parse: [] as [] };

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
    await safeEditReply(interaction, noMentionPayload(`${header}\n\n${cleanBody}`));
    return;
  }

  if (cleanBody.length <= INLINE_TOTAL_LIMIT) {
    const chunks = splitText(cleanBody, MESSAGE_LIMIT - 64);
    await safeEditReply(interaction, noMentionPayload(`${header}\n\n${chunks[0]}`));
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp(noMentionPayload(chunk));
    }
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(cleanBody, "utf8"), {
    name: "codex-output.txt",
  });
  await safeEditReply(interaction, {
    content: `${header}\n\nOutput was too long for Discord; attached as text.`,
    files: [attachment],
    allowedMentions: NO_MENTIONS,
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
    await message.reply(noMentionPayload(firstContent));
    return;
  }

  if (cleanBody.length <= INLINE_TOTAL_LIMIT) {
    const chunks = splitText(cleanBody, MESSAGE_LIMIT - 64);
    await message.reply(noMentionPayload(formatWithOptionalHeader(header, chunks[0])));
    for (const chunk of chunks.slice(1)) {
      await (message.channel as SendableChannel).send(noMentionPayload(chunk));
    }
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(cleanBody, "utf8"), {
    name: "codex-output.txt",
  });
  await message.reply({
    content: formatWithOptionalHeader(header, "Output was too long for Discord; attached as text."),
    files: [attachment],
    allowedMentions: NO_MENTIONS,
  });
}

export async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  payload: string | OutboundPayload,
): Promise<void> {
  const safePayload = typeof payload === "string" ? noMentionPayload(payload) : payload;
  try {
    await interaction.editReply(safePayload);
    return;
  } catch {
    const channel = interaction.channel;
    if (channel && "send" in channel) {
      await (channel as SendableChannel).send(safePayload);
    }
  }
}

interface SendableChannel {
  send(payload: OutboundPayload): Promise<unknown>;
}

interface OutboundPayload {
  content: string;
  files?: AttachmentBuilder[];
  allowedMentions: typeof NO_MENTIONS;
}

function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";
  let openFence: string | null = null;

  for (const line of lines) {
    if (!current) {
      current = line;
      openFence = updateOpenFence(openFence, line);
      if (current.length > max) {
        chunks.push(...splitOversizedChunk(current, max, openFence));
        current = "";
      }
      continue;
    }

    const next = `${current}\n${line}`;
    if (next.length <= max) {
      current = next;
      openFence = updateOpenFence(openFence, line);
      continue;
    }

    chunks.push(closeOpenFence(current, openFence));
    current = openFence ? `${openFence}\n${line}` : line;
    openFence = updateOpenFence(openFence, line);

    if (current.length > max) {
      chunks.push(...splitOversizedChunk(current, max, openFence));
      current = openFence ? openFence : "";
    }
  }
  if (current) chunks.push(closeOpenFence(current, openFence));
  return chunks;
}

function formatWithOptionalHeader(header: string, body: string): string {
  const cleanHeader = header.trim();
  return cleanHeader ? `${cleanHeader}\n\n${body}` : body;
}

function noMentionPayload(content: string, files?: AttachmentBuilder[]): OutboundPayload {
  return { content, files, allowedMentions: NO_MENTIONS };
}

function updateOpenFence(openFence: string | null, line: string): string | null {
  const match = line.match(/^\s*```/);
  if (!match) return openFence;
  return openFence ? null : line.trimEnd();
}

function closeOpenFence(text: string, openFence: string | null): string {
  return openFence ? `${text}\n\`\`\`` : text;
}

function splitOversizedChunk(text: string, max: number, openFence: string | null): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(" ", max), rest.lastIndexOf("\n", max));
    const end = cut > max * 0.5 ? cut : max;
    const chunk = rest.slice(0, end).trimEnd();
    chunks.push(closeOpenFence(chunk, openFence));
    rest = rest.slice(end).trimStart();
    if (openFence && !rest.startsWith(openFence)) {
      rest = `${openFence}\n${rest}`;
    }
  }
  if (rest) chunks.push(closeOpenFence(rest, openFence));
  return chunks;
}
