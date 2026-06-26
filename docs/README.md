# AgentStash Docs

This folder is the contributor handbook for the app.

The root `README.md` explains how to run it.

These docs explain:

- what the app is solving
- how it is structured
- how data flows through sync, storage, and UI
- where to make changes safely
- which tradeoffs are intentional

## Read in this order

1. `product-overview.md`
2. `runtime-architecture.md`
3. `sync-and-storage.md`
4. `ui-and-interactions.md`
5. `development-guide.md`
6. `decisions-and-roadmap.md`

## If you only need one answer

| Question | Read |
| --- | --- |
| What problem does this app solve? | `product-overview.md` |
| How is Electron/main/preload/renderer wired together? | `runtime-architecture.md` |
| How are sessions discovered, parsed, and persisted? | `sync-and-storage.md` |
| How does the UI behave today? | `ui-and-interactions.md` |
| How do I run, test, package, or debug it? | `development-guide.md` |
| Why were certain tradeoffs made? | `decisions-and-roadmap.md` |

## Key file map

| Concern | Primary file(s) |
| --- | --- |
| Electron bootstrap | `src/main/index.ts` |
| Config | `src/main/config.ts` |
| Sync/discovery | `src/main/sync.ts` |
| Parsing | `src/main/parsers/index.ts` |
| Claude Code ingestion | `src/main/parsers/claude.ts` |
| OpenCode ingestion | `src/main/opencode.ts` |
| Storage/search/detail | `src/main/storage.ts` |
| IPC | `src/main/ipc.ts` |
| Renderer shell | `src/renderer/src/App.tsx` |
| Sidebar/filter UX | `src/renderer/src/components/SessionListSidebar.tsx` |
| Session detail | `src/renderer/src/components/SessionDetailView.tsx` |
| Settings UI | `src/renderer/src/components/SettingsModal.tsx` |
| Shared contracts/helpers | `src/shared/types.ts`, `src/shared/format.ts`, `src/shared/links.ts`, `src/shared/pricing.ts` |

## Guiding principles

- **Read-only by design**: browse and review here; continue work in source tools.
- **One local history**: normalize multiple upstream tools into one model.
- **Preserve useful sessions**: keep local history even when upstream changes.
- **Stay fast as history grows**: incremental sync, virtualization, and chunked detail rendering matter.
- **Keep boundaries typed**: shared contracts and a narrow preload bridge are deliberate.

## Default change workflow

1. Find the owning layer/file.
2. Read the matching doc in this folder.
3. Make the narrowest safe change.
4. Update docs if behavior or architecture changed.
5. Run the validation commands from `development-guide.md`.
