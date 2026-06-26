<p align="center">
  <img src="build/icons/robot-512.png" alt="Copilot Sessions Hub logo" width="140" />
</p>

<h1 align="center">Copilot Sessions Hub</h1>

<p align="center">
  Desktop Electron app (TypeScript + Node 24) that aggregates Copilot sessions from multiple repositories,
  provides full-text search in a resizable left sidebar, and renders selected session details in a chat-style
  main pane.
</p>

<p align="center">
  <a href="https://github.com/tanmayairbase/copilot-sessions-hub/releases/latest">Download</a> •
  <a href="#features">Features</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#development">Development</a> •
  <a href="#production-buildpackage">Packaging</a> •
  <a href="#configuration">Configuration</a>
</p>

<p align="center">
  <img width="1398" height="901" alt="Copilot Sessions Hub screenshot" src="https://github.com/user-attachments/assets/274fa0f2-f7e5-48ab-b15c-183f029b8f09" />
...
  <img width="1727" height="513" alt="Status_and_Copilot_Sessions_Hub" src="https://github.com/user-attachments/assets/0ca69550-510c-4fa2-b5ea-1d88bf80d4a4" />

</p>

## Pain points this app addresses

- Copilot session history is fragmented across tools and repositories, with no single place to browse it.
- Past prompts, responses, and decisions are hard to rediscover once a session is closed.
- There is no reliable full-text search across both user prompts and Copilot responses across all sessions.
- Session history can disappear after retention limits, making older conversations hard or impossible to revisit later.
- As session volume grows, history becomes noisy and harder to organize without filtering, starring, and archiving.

## Features

- Aggregates sessions from Copilot CLI, VS Code Copilot Chat, OpenCode, and Claude Code into one desktop view.
- Syncs from configurable repository roots and keeps synced history locally for later rediscovery.
- Provides full-text search plus repository, model, estimated cost, origin, date, archived, starred, and sub-agent filters.
- Surfaces per-session estimated cost as `$`, `$$`, or `$$$` chips when pricing data is available, with an `Unavailable` filter bucket when no total can be computed.
- Renders a read-only chat-style session detail view with model metadata, IST timestamps, and external-link support.
- Supports local organization with starring, archiving, archived history handling, and quick jumps back to important messages.
- Includes a resizable sidebar, settings UI, editable JSON config, and optional background sync.

## Documentation

Contributor-focused architecture and implementation docs live in [`docs/`](docs/README.md).

Start with:

- [`docs/README.md`](docs/README.md)
- [`docs/runtime-architecture.md`](docs/runtime-architecture.md)
- [`docs/sync-and-storage.md`](docs/sync-and-storage.md)
- [`docs/ui-and-interactions.md`](docs/ui-and-interactions.md)

## Prerequisites

- Node.js 24+
- pnpm 10+
- VS Code CLI on PATH (`code`) if you want one-click VS Code open action
- `gh` CLI installed/authenticated if you want one-click CLI open action

## Development

```bash
pnpm install
pnpm dev
```

This starts Electron with HMR for the renderer.

### Troubleshooting: `Error: Electron uninstall` on `pnpm dev`

If you see this error, the Electron binary was not downloaded yet.

Run:

```bash
pnpm run postinstall
```

Then retry:

```bash
pnpm dev
```

## Testing

```bash
pnpm test
```

Includes parser, formatter, and UI component tests with coverage.

## Lint and type-check

```bash
pnpm lint
pnpm typecheck
```

This repo also includes a root `tsconfig.json` and workspace VS Code TypeScript settings so the editor uses the same project graph and local TypeScript version as the CLI checks.

## Production build/package

Build app bundles:

```bash
pnpm build
```

Create distributables for current platform:

```bash
pnpm package
```

Create a macOS DMG explicitly:

```bash
pnpm package:mac
```

Create a Windows installer executable (`.exe`) for standard Windows x64 machines:

```bash
pnpm package:win
```

Optional: create a Windows ARM64 installer:

```bash
pnpm package:win:arm64
```

Artifacts are generated in `release/`.

Windows packaging outputs an installer like:

```text
release/Copilot Sessions Hub Setup <version>.exe
```

On macOS, cross-building Windows installers may download Wine/NSIS helper binaries on the first run, so the first packaging pass can take longer.

## Configuration

Settings are stored in user data `config.json`.

Default repo roots on first run (platform-specific):

**macOS:**

- `~/projects/airbase-frontend`
- `~/projects/frontend2`
- `~/projects`
- `~/projects/Airbase.Playwright.Automation.Suite`

**Windows:**

- `%USERPROFILE%\projects`
- `%USERPROFILE%\Documents`
- `%USERPROFILE%\source`

**Linux:**

- `~/projects`
- `~/code`

You can edit config from:

- In-app **Settings** modal
- In-app **Open Config JSON** button

Config shape:

```json
{
  "repoRoots": ["/absolute/path/to/repo"],
  "discoveryMode": "both",
  "appearance": "system",
  "syncMode": "manual",
  "backgroundSyncIntervalMinutes": 10,
  "explicitPatterns": [
    "**/.copilot/**/*.{json,jsonl}",
    "**/.vscode/**/*copilot*.{json,jsonl}",
    "**/.github/copilot/**/*.{json,jsonl}"
  ]
}
```

- Regardless of `discoveryMode`, the app always scans the global Copilot CLI, VS Code Copilot Chat, and Claude Code session paths (e.g. `~/.claude/projects/**/*.jsonl`) so those sources are picked up without any config. The exact paths are listed in the Settings modal.
- `discoveryMode: "autodiscovery"` uses built-in patterns.
- `discoveryMode: "explicit"` uses only `explicitPatterns`.
- `discoveryMode: "both"` combines both.
- `appearance: "system"` follows the OS theme, while `"light"` and `"dark"` force the app theme.
- `syncMode: "manual"` keeps sync user-triggered only.
- `syncMode: "manual-plus-background"` enables periodic background sync.
- `backgroundSyncIntervalMinutes` controls periodic sync cadence (1-1440).

Saving settings immediately updates config and triggers a sync.

## Logging

Detailed logs are written to:

- `<userData>/logs/app.log` (main process)
- Browser devtools console (renderer/UI actions)
