export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkspaceConfig {
  id: string;
  path: string;
}

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  allowedUserIds: Set<string>;
  allowedGuildIds: Set<string>;
  allowedChannelIds: Set<string>;
  workspaces: Map<string, WorkspaceConfig>;
  workspaceRoots: string[];
  defaultWorkspaceId: string;
  codexCommand: string;
  codexSandbox: "read-only" | "workspace-write" | "danger-full-access";
  codexFullAuto: boolean;
  codexModel?: string;
  codexProfile?: string;
  codexTimeoutMs: number;
  codexExtraArgs: string[];
  autoRegisterCommands: boolean;
  logLevel: LogLevel;
  dataDir: string;
  enableMessageSessions: boolean;
  enableDmPolling: boolean;
  dmPollIntervalMs: number;
  continueGuildChannelSessions: boolean;
}

export interface CodexRunRequest {
  prompt: string;
  workspace: WorkspaceConfig;
  requestedBy: string;
  channelId: string;
  resumeSessionId?: string;
}

export interface CodexRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  finalMessage: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  sessionId?: string;
}

export interface ActiveJobSnapshot {
  id: string;
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  userId: string;
  startedAt: number;
  promptPreview: string;
}

export interface SessionRecord {
  routeKey: string;
  sessionId: string;
  workspaceId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  lastPromptPreview: string;
}

export interface WorkspacePreferenceRecord {
  routeKey: string;
  workspaceId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  updatedAt: number;
}
