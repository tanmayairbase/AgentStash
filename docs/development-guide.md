# Development Guide

## Prerequisites

- Node.js `24+`
- `pnpm 10+`

Optional:

- `code` on `PATH` for VS Code open actions
- `gh` authenticated for CLI-related open flows

## Core commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm package
pnpm package:mac
pnpm package:win
pnpm package:win:arm64
```

Artifacts from packaging are emitted to `release/`.

## Standard validation loop

For non-trivial changes, run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Troubleshooting

### `Error: Electron uninstall` on `pnpm dev`

Run:

```bash
pnpm run postinstall
pnpm dev
```

### VS Code shows TS errors that `pnpm typecheck` does not

Check that VS Code is using:

- the workspace TypeScript version
- the repo root workspace

Then reload the TypeScript server.

### Logs

- main process: `<userData>/logs/app.log`
- renderer diagnostics: browser devtools console

## Repo structure

```text
src/
  main/        Electron main process, sync, config, persistence, IPC
  preload/     typed renderer bridge
  renderer/    React UI
  shared/      shared types, formatters, link helpers
tests/         vitest unit/integration/renderer tests
build/icons/   app icons
docs/          contributor documentation
```

## Test map

| Test file | Focus |
| --- | --- |
| `tests/parsers.test.ts` | parser normalization |
| `tests/sync-claude-code.test.ts` | Claude Code session discovery/parsing |
| `tests/storage-retention.test.ts` | retention, stars, archive behavior |
| `tests/storage-perf-benchmark.test.ts` | high-volume storage performance checks |
| `tests/sync-incremental.test.ts` | incremental sync behavior |
| `tests/pricing.test.ts` | pricing rates and estimated-cost categorization |
| `tests/sidebar.test.tsx` | sidebar filtering/rendering |
| `tests/session-cost-chip.test.tsx` | session cost chip behavior |
| `tests/session-detail-grouping.test.tsx` | detail transcript behavior |
| `tests/app-sync-refresh.test.tsx` | selected detail refresh after sync |
| `tests/external-links.test.ts` | external link rules |
| `tests/settings-modal.test.tsx` | settings UI behavior |

## Common change recipes

### Add a config field

1. update `AppConfig` in `src/shared/types.ts`
2. update schema/defaults in `src/main/config.ts`
3. expose it through preload/IPC if needed
4. update `SettingsModal.tsx`
5. add tests and docs

### Add session metadata

1. update shared types
2. extract/normalize in parsers or source-specific loaders
3. persist/index in `SessionStorage`
4. surface it in the renderer if appropriate
5. add tests

### Change search behavior

Primary places:

- `src/main/storage.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/SessionListSidebar.tsx`

### Change transcript rendering

Primary places:

- `src/renderer/src/components/SessionDetailView.tsx`
- `src/shared/links.ts`
- `src/renderer/src/styles.css`

## Packaging

`electron-builder` is configured from `package.json`.

Current targets:

- macOS: `dmg`
- Windows: `nsis`
- Linux: `AppImage`

Helpful release commands:

```bash
pnpm package:mac
pnpm package:win
pnpm package:win:arm64
```

Expected Windows installer artifact:

```text
release/Copilot Sessions Hub Setup <version>.exe
```

Notes:

- `pnpm package:win` targets Windows `x64`, which is the default release target most users will want.
- `pnpm package:win:arm64` is available for Windows on ARM.
- On macOS, the first Windows packaging run may download Wine/NSIS helper binaries and take longer than usual.

## Doc hygiene

If you change architecture, sync semantics, visible UX, supported sources, or major product decisions, update the matching file in `docs/`.
