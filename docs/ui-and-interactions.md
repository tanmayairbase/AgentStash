# UI and Interactions

## What this layer does

The renderer turns the normalized local store into a fast, read-only browsing experience.

Primary files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/SessionListSidebar.tsx`
- `src/renderer/src/components/SessionDetailView.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/styles.css`

## Layout

The app has:

- a top bar for sync/settings/config actions
- a left sidebar for search, filters, and session selection
- a right detail pane for the selected transcript
- a footer/status area for sync and toast-like status text

## Renderer ownership

`App.tsx` owns:

- loaded config
- sessions and starred message lists
- selected session/detail
- search and filter state
- sync state and queueing
- background sync status
- sidebar width persistence
- status/toast messaging

Child components focus on presentation and local interaction details.

## Sidebar

Primary file:

- `SessionListSidebar.tsx`

Current behavior:

- debounced free-text search
- filters for repository, model, estimated cost, origin, date, archived, starred, and sub-agent sessions
- stats button beside Filters/Clear opens modal for current filtered-session cost summary
- archived sessions hidden by default
- separate archived-match handling during search
- local archive/unarchive actions
- session rows show an estimated cost chip (`$`, `$$`, `$$$`) when a session total can be priced
- virtualized rows once the list is large enough

Important list constants:

- estimated row height: `88`
- overscan: `320px`
- virtualization threshold: `80`

## Detail pane

Primary file:

- `SessionDetailView.tsx`

Current behavior:

- read-only transcript
- markdown and ANSI rendering
- artifact chips for references and edits
- token-usage visualization and estimated-cost detail when token pricing data is available
- message starring
- grouped same-role messages within the same IST minute
- chunked transcript rendering with `Load older messages`

Important detail constant:

- chunk size: `220` grouped messages

## Scroll and focus rules

Current intended behavior:

- selecting a different session resets the transcript to the **top**
- deep links, such as starred-message jumps, can scroll a target message into view

This is intentionally optimized for review rather than “resume where I left off”.

## Message-level mode styling

For Copilot CLI and Claude Code sessions, the app can style user messages with:

- `Plan`
- `Autopilot`

Important boundary:

- mode styling stays at the **message level only**
- there are no sidebar or detail-header mode pills

## External links

Transcript links always open in the default external browser.

That applies to:

- normal clicks
- new-window attempts

The Electron window should not navigate away to external content.

## Settings modal

Primary file:

- `SettingsModal.tsx`

Editable fields:

- repository roots
- discovery mode
- explicit glob patterns
- sync mode
- background sync interval

Save behavior:

- validate and normalize in the main process
- update renderer config state
- trigger a sync immediately

## Background sync

When `manual-plus-background` is enabled, the renderer schedules periodic syncs.

Important queueing rules:

- only one sync runs at a time
- settings-save sync outranks manual sync
- manual sync outranks background sync
- a queued lower-priority sync can be replaced by a higher-priority one

## Quick actions boundary

The UI can hand off to:

- VS Code
- terminal / CLI resume flow

Those actions reopen context in source tools; they do not embed those tools inside the app.

## Where to make UI changes

| Change | Primary file(s) |
| --- | --- |
| shell state / screen flow | `src/renderer/src/App.tsx` |
| sidebar rows, filters, virtualization | `src/renderer/src/components/SessionListSidebar.tsx` |
| transcript rendering, grouping, scroll behavior | `src/renderer/src/components/SessionDetailView.tsx` |
| settings form | `src/renderer/src/components/SettingsModal.tsx` |
| styling and spacing | `src/renderer/src/styles.css` |

## UX constraints worth preserving

- keep the app read-only
- avoid unnecessary chrome
- keep new metadata close to where it matters
- prefer simple filters over complex query builders
- optimize for quick scanning and easy return to source tools
