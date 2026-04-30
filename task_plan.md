# Task Plan

## Goal
Act as a manual QA engineer for `claude-yh` by validating the current branch through real user-facing functional testing, not only unit tests and type checks.

## Current Focus
Investigate the user's report that responses appear non-streaming even though the app is expected to support streaming output.

## Phases
- [completed] Define the manual test matrix and isolate runtime state from the user's real config
- [completed] Execute CLI and local-config functional tests
- [completed] Execute server/API/WebSocket functional tests
- [completed] Execute one real model-path end-to-end validation if credentials/environment allow
- [completed] Summarize validated flows, failures, and residual risk
- [completed] Trace and reproduce the desktop streaming path end-to-end
- [completed] Fix the broken layer if the runtime path is falling back to non-streaming
- [completed] Re-verify streaming behavior with a live/manual session

## Constraints
- Do not touch the user's separate original Claude config unless explicitly asked.
- Keep protocol names, model IDs, and external auth endpoints stable when renaming would break functionality.
- Focus renames on user-visible commands, comments, docs, local config directory names, and safe branding text.
- Prefer temporary `HOME` / `USERPROFILE` sandboxes for any runtime verification that writes settings or session data.

## Verification Targets
- `bun --env-file=.env .\\src\\entrypoints\\cli.tsx --help`
- `bun --env-file=.env .\\src\\entrypoints\\cli.tsx -p "..."` in an isolated temp home
- `src/server/index.ts` boot in an isolated temp home
- `/health`, `/api/status`, `/api/settings`, `/api/sessions`, `/api/scheduled-tasks`, `/api/providers` manual API checks
- WebSocket chat handshake and at least one message flow
- `bun test`
- `bun x tsc --noEmit -p tsconfig.json`

## Streaming Investigation Notes
- Confirm whether the upstream provider returns stream events or only a final assistant payload.
- Confirm whether `src/server/ws/handler.ts` emits `content_delta` / `thinking` for the current runtime path.
- Confirm whether `desktop/src/stores/chatStore.ts` receives and renders incremental `streamingText`.
- [completed] 修复 Tauri sidecar 未加载根目录 `.env`
- [completed] 修复旧 `settings.model` 抢占当前显示模型
- [completed] 修复旧 `settings.model` 抢占 CLI 实际调用模型
- [completed] 重启根目录后端与 Tauri 开发壳，确认桌面端已运行
