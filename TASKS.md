# Tasks

## MVP Complete

- Scaffold Node/TypeScript project.
- Register `/codex` slash command on startup.
- Add `/codex ask`, `/codex cancel`, `/codex status`, `/codex workspaces`.
- Gate access by `ALLOWED_USER_IDS`, optional guild/channel allowlists.
- Restrict execution to configured `WORKSPACES` and `WORKSPACE_ROOTS`.
- Run local `codex exec --json` with `--output-last-message`.
- Enforce one active job per Discord channel and workspace.
- Add timeout, cancel, long-output splitting, and attachment fallback.
- Add DM / @mention message sessions with persisted Codex session ids.
- Add `/codex new`, `/codex close`, and message controls `/new`, `/close`, `/status`.
- Add private-server channel sessions without requiring `@codex`.
- Add workspace switching with `/workspace`, `/use`, and nested paths under workspace roots.

## Setup Tasks

- Create Discord application and bot token.
- Set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in `.env`.
- Set `DISCORD_GUILD_ID` for development command registration.
- Set `ALLOWED_USER_IDS` to your Discord user id.
- Set `WORKSPACE_ROOTS` to the local repo root Codex may touch.
- Optionally set `WORKSPACES` for manual aliases/overrides.
- Enable Message Content Intent in the Discord Developer Portal for message sessions.
- Run `npm run dev`.

## Next Iteration

- Add `claude` backend beside Codex.
- Add per-workspace queue instead of rejecting concurrent requests.
- Add structured event parsing for better progress messages.
- Add optional Discord thread-per-job mode.
- Add launchd or pm2 service config for always-on local runtime.
