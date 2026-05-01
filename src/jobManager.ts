import type { AppConfig, ActiveJobSnapshot, CodexRunRequest, CodexRunResult } from "./types.js";
import { runCodex, type RunningCodexProcess } from "./codexRunner.js";

interface ActiveJob {
  process: RunningCodexProcess;
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  userId: string;
  promptPreview: string;
}

export class JobManager {
  private jobsByChannel = new Map<string, ActiveJob>();
  private channelsByWorkspace = new Map<string, string>();

  constructor(private readonly config: AppConfig) {}

  start(request: CodexRunRequest): ActiveJobSnapshot {
    if (this.jobsByChannel.has(request.channelId)) {
      throw new Error("This channel already has a running Codex job.");
    }
    if (this.channelsByWorkspace.has(request.workspace.id)) {
      throw new Error(`Workspace '${request.workspace.id}' already has a running Codex job.`);
    }

    const process = runCodex(this.config, request);
    const job: ActiveJob = {
      process,
      workspaceId: request.workspace.id,
      workspacePath: request.workspace.path,
      channelId: request.channelId,
      userId: request.requestedBy,
      promptPreview: preview(request.prompt),
    };
    this.jobsByChannel.set(request.channelId, job);
    this.channelsByWorkspace.set(request.workspace.id, request.channelId);
    process.done.finally(() => this.remove(request.channelId, request.workspace.id)).catch(() => {});
    return this.snapshot(job);
  }

  resultFor(channelId: string): Promise<CodexRunResult> | null {
    return this.jobsByChannel.get(channelId)?.process.done ?? null;
  }

  cancel(channelId: string): boolean {
    const job = this.jobsByChannel.get(channelId);
    if (!job) return false;
    job.process.cancel();
    return true;
  }

  status(channelId?: string): ActiveJobSnapshot[] {
    const jobs = [...this.jobsByChannel.values()];
    return jobs
      .filter((job) => !channelId || job.channelId === channelId)
      .map((job) => this.snapshot(job));
  }

  private remove(channelId: string, workspaceId: string): void {
    this.jobsByChannel.delete(channelId);
    if (this.channelsByWorkspace.get(workspaceId) === channelId) {
      this.channelsByWorkspace.delete(workspaceId);
    }
  }

  private snapshot(job: ActiveJob): ActiveJobSnapshot {
    return {
      id: job.process.id,
      workspaceId: job.workspaceId,
      workspacePath: job.workspacePath,
      channelId: job.channelId,
      userId: job.userId,
      startedAt: job.process.startedAt,
      promptPreview: job.promptPreview,
    };
  }
}

function preview(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
