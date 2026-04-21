# Progress

## 2026-04-21
- Switched task tracking from the previous OpenAI transport work to the new QA/remediation request.
- Confirmed the active repo is `C:\Users\y1513\Desktop\cc\cc-yh`; the path `C:\Users\y1513\Desktop\cc-haha` from the session context does not exist.
- Reviewed `docs/handoff-2026-04-21-ai-transfer.md` and confirmed it only covers `src/utils/messages.ts` / `src/utils/__tests__/messages.test.ts`.
- Expanded `messages` regression coverage to malformed nested content and malformed nested `agent_progress` payloads.
- Hardened `src/utils/messages.ts` so malformed known message shapes no longer throw during normalization.
- Replaced the default local config directory naming from `.claude` / `~/.claude` to `.claude-yh` / `~/.claude-yh` across the tested paths, and renamed the repo-local `.claude` directory to `.claude-yh`.
- Fixed the `claude --resume` output path so resume hints now emit `claude-yh --resume`.
- Updated high-signal CLI/help/Remote Control copy to `claude-yh` / `claude-yh.ai`.
- Fixed Bun desktop test compatibility centrally in `desktop/src/test/setupDom.ts` by shimming `vi.hoisted` and `vi.advanceTimersByTimeAsync`.
- Fixed the remaining desktop React namespace type mismatches in:
  - `desktop/src/components/layout/Sidebar.tsx`
  - `desktop/src/components/layout/TitleBar.tsx`
- Verified targeted regressions:
  - `bun test src/utils/__tests__/messages.test.ts`
  - `bun test src/utils/__tests__/cronTasks.test.ts`
  - `bun test desktop\\src\\stores\\chatStore.test.ts desktop\\src\\stores\\hahaOAuthStore.test.ts desktop\\src\\stores\\sessionStore.test.ts desktop\\src\\components\\chat\\MermaidRenderer.test.tsx`
  - `bun --env-file=.env .\\src\\entrypoints\\cli.tsx --help`
- Verified full project health:
  - `bun x tsc --noEmit -p desktop\\tsconfig.json`
  - `bun x tsc --noEmit -p tsconfig.json`
  - `bun test`
- Final result:
  - `bun test`: `820 pass / 0 fail`
  - both TypeScript checks pass

## 2026-04-21 Manual QA Follow-up
- Switched from code-level verification to manual functional validation at the user's request.
- Added a new plan focused on isolated runtime testing of CLI, config storage, API/server flows, WebSocket chat, and real model-path validation where possible.
