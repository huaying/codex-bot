import fs from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, WorkspacePreferenceRecord } from "./types.js";

interface SessionStoreFile {
  version: 1 | 2;
  sessions: SessionRecord[];
  workspacePreferences?: WorkspacePreferenceRecord[];
}

export class SessionStore {
  private readonly filePath: string;
  private sessions = new Map<string, SessionRecord>();
  private workspacePreferences = new Map<string, WorkspacePreferenceRecord>();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "sessions.json");
  }

  async load(): Promise<void> {
    const raw = await fs.readFile(this.filePath, "utf8").catch(() => "");
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw) as Partial<SessionStoreFile>;
    for (const record of parsed.sessions ?? []) {
      if (record.routeKey && record.sessionId && record.workspaceId) {
        this.sessions.set(record.routeKey, record);
        if (!this.workspacePreferences.has(record.routeKey)) {
          this.workspacePreferences.set(record.routeKey, {
            routeKey: record.routeKey,
            workspaceId: record.workspaceId,
            channelId: record.channelId,
            guildId: record.guildId,
            userId: record.userId,
            updatedAt: record.updatedAt,
          });
        }
      }
    }
    for (const record of parsed.workspacePreferences ?? []) {
      if (record.routeKey && record.workspaceId) {
        this.workspacePreferences.set(record.routeKey, record);
      }
    }
  }

  get(routeKey: string): SessionRecord | undefined {
    return this.sessions.get(routeKey);
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getWorkspacePreference(routeKey: string): WorkspacePreferenceRecord | undefined {
    return this.workspacePreferences.get(routeKey);
  }

  async setWorkspacePreference(record: WorkspacePreferenceRecord): Promise<void> {
    this.workspacePreferences.set(record.routeKey, record);
    await this.save();
  }

  async upsert(record: SessionRecord): Promise<void> {
    this.sessions.set(record.routeKey, record);
    this.workspacePreferences.set(record.routeKey, {
      routeKey: record.routeKey,
      workspaceId: record.workspaceId,
      channelId: record.channelId,
      guildId: record.guildId,
      userId: record.userId,
      updatedAt: record.updatedAt,
    });
    await this.save();
  }

  async delete(routeKey: string): Promise<boolean> {
    const deleted = this.sessions.delete(routeKey);
    if (deleted) await this.save();
    return deleted;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: SessionStoreFile = {
      version: 2,
      sessions: [...this.sessions.values()].sort((a, b) => a.routeKey.localeCompare(b.routeKey)),
      workspacePreferences: [...this.workspacePreferences.values()].sort((a, b) =>
        a.routeKey.localeCompare(b.routeKey),
      ),
    };
    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
