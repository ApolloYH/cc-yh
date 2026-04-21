# Findings

- `claude-yh` already has Anthropic<->OpenAI transform code and provider UI/server fields for `openai_chat` and `openai_responses`.
- The remaining blocker after prior work is the main streaming branch in `src/services/api/claude.ts`, which still calls `anthropic.beta.messages.create(...).withResponse()`.
- Direct OpenAI compat can reuse the existing Anthropic<->OpenAI transform layer; the essential changes are transport selection and provider env sync.
- `desktop/src/pages/Settings.tsx` needed explicit cleanup of compat env keys when switching back to Anthropic, otherwise preview JSON could show stale compat flags.
- `bun-types` was genuinely missing; installing it unblocked `tsc` startup.
- After that, full-repo `tsc` surfaced a large pre-existing backlog of unrelated type errors and missing optional packages (`vitest`, `grammy`, `@larksuiteoapi/node-sdk`, several OpenTelemetry exporters, etc.).
- The direct compat layer had two concrete protocol gaps that are easy to trigger in real workloads:
  - interleaved `user` text and `tool_result` blocks were reordered during conversion
  - long tool names could exceed provider limits and were not restored on the way back
- Streaming tool-call handling also needed delayed `tool_use` block starts so providers that send tool arguments before the final function name do not produce malformed Anthropic blocks.
- The old proxy request transforms had the same quality gap as the direct compat path. They now share the same practical safeguards:
  - order-preserving `tool_result` emission
  - tool-name normalization mapping
  - document block text fallback
  - serialized nested tool-result content
