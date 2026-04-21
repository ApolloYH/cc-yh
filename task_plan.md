# Task Plan

## Goal
Port `doge-code`'s direct OpenAI-compatible transport into `claude-yh` so OpenAI providers work without LiteLLM or the local proxy bridge.

## Phases
- [completed] Wire direct OpenAI compat into `src/services/api/claude.ts`
- [completed] Switch provider env sync away from local proxy
- [completed] Update desktop preview/config display
- [completed] Add focused regression tests
- [completed] Run targeted verification

## Notes
- Keep Anthropic path unchanged.
- OpenAI providers should use upstream `baseUrl` and real `apiKey`.

## Verification
- `bun test src/server/__tests__/provider-openai-direct.test.ts`
- `bun -e "await import('./src/services/api/claude.ts'); console.log('claude-import-ok')"`
- Installed `bun-types` and confirmed `bun x tsc --noEmit -p tsconfig.json` now starts.
- Targeted type-check for the changed proxy transform files passes.
- Full repo type-check still reports many unrelated historical errors and missing optional dependencies outside this change set.
