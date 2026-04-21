# Progress

## 2026-04-20
- Resumed from prior work on direct OpenAI compat port.
- Created lightweight planning files to track remaining phases and verification.
- Patched `src/services/api/claude.ts` so OpenAI providers can stream and non-stream directly to `/chat/completions` or `/responses` without the local proxy.
- Patched provider env sync and desktop preview to write upstream `ANTHROPIC_BASE_URL` and real `ANTHROPIC_AUTH_TOKEN`, plus compat mode env vars for OpenAI formats.
- Added `src/server/__tests__/provider-openai-direct.test.ts` and passed 3 targeted tests.
- Verified Bun can import `src/services/api/claude.ts`; full `tsc --noEmit` is blocked by missing `bun-types`.
- Hardened the direct compat transforms for:
  - interleaved `tool_result` ordering
  - long tool name truncation + reverse restoration
  - document/text fallback handling
  - delayed streamed tool-call start until function names are available
  - Responses API `system -> instructions`
- Added `src/services/api/__tests__/openai-compat.test.ts` and passed 3 targeted transform tests.
- Re-ran `src/server/__tests__/proxy-transform.test.ts` to confirm the broader transform layer still passes.
- Installed `bun-types` with `bun add -d bun-types`.
- Reworked `src/server/proxy/transform/anthropicToOpenaiChat.ts` and `anthropicToOpenaiResponses.ts` to match the hardened direct compat behavior.
- Added proxy transform tests for ordering preservation and long tool-name normalization.
- Verified targeted type-check for the modified proxy transform files and handler passes.
