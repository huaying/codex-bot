# Codex Discord Bridge

Run your local Codex CLI from Discord. The bot supports DM sessions and private
server channels, with one saved Codex thread per Discord conversation.

## Requirements

- Node.js 20+
- Codex CLI installed and authenticated locally
- A Discord application with a bot token

## Setup

```bash
npm install
cp .env.example .env
```

Create a Discord app at <https://discord.com/developers/applications>.

1. Create or select an application.
2. Open **Bot** and reset/copy the bot token into `DISCORD_TOKEN`.
3. Enable **Message Content Intent** if you want guild channel text prompts.
4. Open **OAuth2 > URL Generator**.
5. Select scopes: `bot`, `applications.commands`.
6. Select permissions: View Channels, Send Messages, Read Message History, Use Slash Commands.
7. Use the generated URL to invite the bot to your private server.

Fill the required `.env` values:

```env
DISCORD_TOKEN=replace_me
DISCORD_CLIENT_ID=replace_me
DISCORD_GUILD_ID=your_test_server_id
ALLOWED_USER_IDS=your_discord_user_id
ALLOWED_GUILD_IDS=your_private_server_id
WORKSPACE_ROOTS=/Users/you/Dev
DEFAULT_WORKSPACE_ID=codex-bot
```

Start the bridge:

```bash
npm run dev
```

Slash commands are registered on startup when `AUTO_REGISTER_COMMANDS=true`.
Using `DISCORD_GUILD_ID` during development makes command updates appear quickly.

## Usage

DM the bot directly:

```text
hi
```

Each DM conversation maps to one saved Codex thread. Later messages resume the
same Codex context.

In a private server, you can use one channel per task/session. With:

```env
CONTINUE_GUILD_CHANNEL_SESSIONS=true
```

messages in allowlisted guild channels can start and continue Codex sessions
without `@codex`. Different channels map to different Codex threads.

Useful message controls:

```text
/status
/new
/close
/workspaces
/workspace
/workspace thoth
/use thoth/athena
```

- `/status` shows the current saved session and workspace.
- `/new` clears the current Codex thread; the next prompt starts fresh.
- `/close` clears the current thread and cancels any running job in the channel.
- `/workspaces` lists first-level workspaces discovered from `WORKSPACE_ROOTS`.
- `/workspace` or `/use` shows the active workspace for the DM/channel.
- `/workspace <id>` or `/use <id>` switches workspace and clears the old thread.

Nested paths are allowed only when explicitly requested and only under
`WORKSPACE_ROOTS`. For example, with `WORKSPACE_ROOTS=/Users/you/Dev`,
`/use thoth/athena` resolves to `/Users/you/Dev/thoth/athena`.

Slash commands are also available:

```text
/codex ask prompt:<text> workspace:<id?>
/codex status
/codex cancel
/codex new
/codex close
/codex workspace id:<workspace?>
/codex workspaces
```

## Workspaces

Workspace access is allowlisted. The bot never accepts arbitrary absolute paths
from Discord.

`WORKSPACE_ROOTS` discovers direct child folders:

```env
WORKSPACE_ROOTS=/Users/you/Dev
```

`WORKSPACES` can add manual aliases or overrides:

```env
WORKSPACES=app:/Users/you/Dev/my-app;bot:/Users/you/Dev/codex-bot
```

If both are set, manual `WORKSPACES` aliases win when ids overlap.

## Safety

- Only users in `ALLOWED_USER_IDS` can run Codex.
- `ALLOWED_GUILD_IDS` restricts guild/server usage.
- `ALLOWED_CHANNEL_IDS` can further restrict where the bot responds.
- `.env`, `.data`, `node_modules`, and `dist` are ignored by git.
- Default execution is `CODEX_SANDBOX=workspace-write`.
- `CODEX_FULL_AUTO=true` runs `codex exec --full-auto` in the sandbox.
- The bridge rejects `--dangerously-bypass-approvals-and-sandbox`.

If a bot token was pasted into chat or committed, reset it immediately in the
Discord Developer Portal and update `.env`.

## Runtime Notes

- Message sessions use Discord Gateway `messageCreate` events.
- `ENABLE_DM_POLLING=false` by default; polling is only a debugging fallback.
- On startup, the bot performs one recent-DM catch-up to avoid missing messages
  sent during restart.
- Successful message-session replies hide job metadata. Failures include status,
  job id, and stderr for debugging.
- Changing `.env` requires restarting `npm run dev`.
- Approval prompts from Codex are not implemented as Discord buttons. The current
  mode is sandboxed full-auto, not unrestricted YOLO.

## Development

```bash
npm run check
npm run build
```

Before pushing:

```bash
npm run check
npm run build
```

Also verify that `.env` is not committed and that any leaked Discord token has
been reset.
