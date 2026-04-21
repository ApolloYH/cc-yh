# Task Plan

## Goal
Act as a manual QA engineer for `claude-yh` by validating the current branch through real user-facing functional testing, not only unit tests and type checks.

## Phases
- [in_progress] Define the manual test matrix and isolate runtime state from the user's real config
- [pending] Execute CLI and local-config functional tests
- [pending] Execute server/API/WebSocket functional tests
- [pending] Execute one real model-path end-to-end validation if credentials/environment allow
- [pending] Summarize validated flows, failures, and residual risk

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
