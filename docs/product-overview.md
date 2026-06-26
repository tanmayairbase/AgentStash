# Product Overview

## What this app is

`Copilot Sessions Hub` is a read-only desktop viewer for Copilot session history.

It aggregates local session data from multiple tools, normalizes it into one model, and makes it easy to search and review old conversations.

It is **not** a chat client and does not send prompts to Copilot.

## Pain points it addresses

- Copilot session history is fragmented across tools and repositories, with no single place to browse it.
- Past prompts, responses, and decisions are hard to rediscover once a session is closed.
- There is no reliable full-text search across both user prompts and Copilot responses across all sessions.
- Session history can disappear after retention limits, making older conversations hard or impossible to revisit later.
- As session volume grows, history becomes noisy and harder to organize without filtering, starring, and archiving.

## Product shape

The current product is optimized for:

- syncing local session history from multiple sources
- full-text search plus lightweight filtering
- fast cost-aware scanning with estimated cost chips and filtering when pricing metadata exists
- consolidated stats for current filtered sessions, including estimated cost summaries and model breakdowns
- read-only transcript review
- local organization with starring and archiving
- jumping back to source tools when deeper action is needed

## Supported sources

- **Copilot CLI**
- **VS Code Copilot Chat**
- **OpenCode**
- **Claude Code**

## Core UX rules

- The app is **read-only**.
- User messages render on the right; Copilot messages render on the left.
- Timestamps are shown in **IST**.
- Switching sessions resets the transcript view to the **top**.
- Transcript links open in the **default external browser**.
- Plan/autopilot metadata, when available from Copilot CLI or Claude Code, is shown only at the **message level**.

## Important data behaviors

- Search includes metadata plus message text.
- Synced sessions remain locally available even if later missing upstream.
- Missing upstream sessions are treated as archived history, not immediately deleted.
- Manual archive state is local-only.
- Starred messages are local bookmarks and can survive upstream disappearance as stale entries.

## Non-goals

The app does **not** currently aim to:

- replace Copilot CLI, VS Code, OpenCode, or Claude Code as authoring tools
- support in-app chatting or editing
- expose hidden or raw chain-of-thought
- sync data to a backend
- become a multi-user collaboration product
