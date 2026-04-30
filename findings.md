# Findings

## Source Projects
- `C:\Users\y1513\Desktop\cc\claw-code` contains a Rust workspace with separate crates for API/provider streaming, runtime, tools, plugins, commands, telemetry, a mock Anthropic-compatible service, and a parity harness.
- `claw-code` is most useful as a migration pattern: deterministic mock service, parity checklist, Rust file/search/bash/permission modules, and honest gap tracking.
- `C:\Users\y1513\Desktop\cc\GenericAgent` provides useful ideas around browser control, experience-to-Skill crystallization, autonomous operation SOPs, chat frontends, and L1-L4 memory.

## Current `cc-yh` Capabilities
- `cc-yh` already has a persistent memory system under `src/memdir`, with `MEMORY.md` index files, auto extraction, team memory, and AutoDream.
- `cc-yh` already has a rich Skill system under `src/skills`, including a bundled `skillify` implementation, but several bundled skills are gated behind `USER_TYPE=ant`.
- `cc-yh` already has scheduled tasks and cron support in `src/utils/cron*` and desktop/server task services.
- `cc-yh` already has Telegram and Feishu adapters under `adapters/` with a shared `adapters/common` layer.
- DingTalk and WeCom now have shared config, masking, webhook helpers, and outbound markdown notification delivery for scheduled tasks and Jarvis checkpoints, but not full long-running inbound adapter processes yet.
- `cc-yh` already has Chrome/MCP-oriented browser automation surfaces, including `claude-in-chrome` bundled skill and computer-use code paths.
- Away Runner now has a disabled-by-default policy contract for budgets, checkpoints, pause reasons, and risk levels.
- Away Session now has a 24h Jarvis Mode surface: shared config in `settings.json`, JSONL checkpoint history, server daemon, REST API, `/jarvis` CLI command, desktop/web page, and DingTalk/WeCom checkpoint notification hooks.
- Rust runtime sidecar now has a read-only `session.index` method with TypeScript fallback, query filtering, and a server API.
- Rust runtime sidecar now also owns parity-tested `fs.glob` / `fs.grep` walk options (`hidden`, `.gitignore`, default directory exclusions, deny glob exclusions). CLI GlobTool, web APIs, and desktop/web workbench can use the same Rust-backed runtime path with TypeScript fallback.
- BrowserControl now persists policy, defaults to enabled, exposes action assessment/execution, has a `/browser` CLI surface, has web/desktop Settings > Browser controls, and can execute through a GA-compatible local TMWD bridge connected to the user's current Chrome extension session.
- Skill distillation now has a reviewed-save server API that writes real `SKILL.md` files to user or project scope.
- MemoryV2 now has an actual store/API for L1 pointer index, L2 facts, L3 SOPs, L4 session summaries/raw archives, verified-only promotion, stale checks, local token-vector search, and distillation candidates.

## Gaps To Address
- Skill distillation now has a web/desktop Agent Workbench path that can save a reviewed project-scope `SKILL.md`; broader dedicated review UX can still be improved later.
- MemoryV2 now has both an Agent Workbench path and a Settings > Memory path. CLI `/memory` also supports listing, showing, searching, summarizing, stale checks, and distillation. Existing legacy memory paths still need gradual product integration.
- Scheduled tasks now evaluate Away Runner policy before execution, write initial/final Jarvis events, and wrap prompts with budget/stop-condition instructions when Away Runner is enabled.
- Browser automation now has a stable policy/execution contract, a GA-compatible `tmwd-cdp-bridge` current-Chrome path, a Chrome DevTools fallback, audit logging, a bundled browser Skill prompt, a `/browser` CLI command, and a web/desktop Settings surface. It is default-on, with sensitive confirmation and denied-domain controls still available.
- DingTalk / WeCom now have a unified inbound HTTP task bridge in addition to outbound robot notifications; platform-native event signature verification and long-poll/stream processes still remain future hardening.
- Jarvis Mode now supports a continuous task prompt in assisted/autonomous mode; each checkpoint can hand off one guarded background task through Away Runner. It is still intentionally paused for login, captcha, payment, secrets, and irreversible user decisions.
- Rust session index, fs search, file read/write runtime API, and shell risk classification have real sidecar tests. MemoryV2 consumes the session index for L4 summaries, and CLI GlobTool/GrepTool route through Rust runtime where parity is covered.
- Personal WeChat requires careful permission/compliance boundaries.

## Risk Notes
- The GA Chrome extension requests broad permissions (`cookies`, `tabs`, `debugger`, `management`, `<all_urls>`) and earlier code included CSP modification behavior. It should never be silently installed; the adapted `extensions/tmwd_cdp_bridge` copy keeps the current-session bridge but avoids default CSP header removal, while product policy defaults BrowserControl itself to enabled after installation.
- Personal WeChat automation has account-risk and protocol-stability concerns; DingTalk and WeCom should come first.
- Rust rewrites can regress behavior unless every swapped module is protected by parity tests.

## 2026-04-27 Code Review After Rust Closure
- Agent loop full Rust migration should not be pursued now. The highest-value Rust boundaries are already in place: shell policy, file write boundary, glob/grep, session index cache, and Jarvis queue locks.
- The largest maintainability hotspot is `src/browserControl/executor.ts` at about 38 KB. It combines policy finalization, Chrome DevTools execution, TMWD bridge execution, HTTP bridge execution, screenshot/click/type helpers, tab recovery, and data summarization. This should eventually be split by backend, but not during user testing because it is a working integration point.
- The second hotspot is `src/memoryV2/store.ts` at about 29 KB. It mixes store paths, L1-L4 reads, writes, summaries, stale checks, vector refresh, and distillation. Safe later split: `paths.ts`, `entries.ts`, `summaries.ts`, `vectors.ts`, `distill.ts`.
- The runtime layer had duplicated sidecar startup/fallback code across fs search, fs ops, shell policy, session index, and Jarvis queue. This was cleaned by adding a shared `tryRustSidecarRequest()` wrapper.
- Test-time diagnosis needed a stable always-on log separate from `--debug`. Added sanitized JSONL diagnostics under `~/.claude-yh/diagnostics/YYYY-MM-DD.jsonl`, plus `GET /api/status/diagnostics-log`.
- Diagnostic logging intentionally redacts token/secret/password/API-key/authorization/cookie/content/prompt/command fields. Shell commands and Jarvis goals are represented by hashes/lengths or caller-provided safe summaries.
