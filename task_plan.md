# Task Plan

## Goal
Improve `claude-yh` by selectively absorbing the strongest ideas from the local `claw-code` Rust rewrite and `GenericAgent`, while preserving existing CLI, desktop, web, provider, memory, skills, and adapter behavior.

## Current Focus
Rust runtime replacement is being advanced through parity-protected lower-level
modules: filesystem search, session indexing, and the shared CLI/web/desktop
runtime API.

## Phases
- [completed] Phase 1: Skill distillation + layered memory foundations
- [completed] Phase 2: Rust runtime boundary and parity harness skeleton
- [completed] Phase 3: BrowserControl abstraction and capability policy
- [completed] Phase 4: DingTalk / WeCom adapter expansion
- [completed] Phase 5: Away Runner autonomous execution mode
- [completed] Phase 6: Rust-accelerated session/memory index
- [in_progress] Phase 7: Production integrations and broader Rust parity candidates
- [completed] Phase 7a: 24h Jarvis Mode shared config, daemon, CLI, and UI
- [completed] Phase 7b: Runtime, BrowserControl, SkillDistiller, MemoryV2, and notification APIs
- [completed] Phase 8: Rust fs.glob/fs.grep acceleration boundary and API
- [completed] Phase 9: Web/desktop integration workbench and real browser task test
- [completed] Phase 10: GA-compatible BrowserControl execution bridge for current Chrome tabs
- [completed] Phase 11: Default-on BrowserControl skill surface and settings integration
- [completed] Phase 12: Four-layer MemoryV2 CLI and Settings integration
- [completed] Phase 13: CLI/web/desktop Rust filesystem runtime integration
- [completed] Phase 14: Finish remaining GA/Jarvis/Memory/Skill/Browser production hooks
- [completed] Phase 15: Production MemoryV2 embedding/FAISS provider and final parity verification
- [completed] Phase 16: Jarvis/Away system autostart watchdog and crash restart path
- [completed] Phase 17: Jarvis independent background agent, cloud runner protocol, IM-to-Jarvis routing, model-backed Skill/Memory quality
- [pending] Phase 18: Optional deeper Rust migration for remaining agent-loop internals

## Constraints
- Do not full-rewrite `cc-yh` in Rust. Rust must be introduced behind a narrow, testable boundary.
- Do not break existing CLI / desktop / web startup or the unified `~/.claude-yh/settings.json` configuration behavior.
- Do not change protocol names or provider environment variables that are required for compatibility.
- Browser automation must not silently bypass login, captcha, 2FA, payment, or sensitive user confirmations.
- Skill and memory promotion must be based on verified execution, not guesses.
- BrowserControl is default-on by product policy, but sensitive execution still needs confirmation and must keep captcha, 2FA, payment, and irreversible-action guardrails.

## Verification Targets
- `bun x tsc --noEmit -p tsconfig.json`
- `bun x tsc --noEmit -p desktop\tsconfig.json`
- targeted tests for changed modules
- functional API tests with real temp settings/session/skill/memory files
- desktop/web visual smoke test through a real browser
- smoke test CLI help / slash command availability where relevant

## Decisions
- Rust will initially be a sidecar/JSON protocol boundary, not a replacement for the agent loop.
- GA-style browser control will be represented as a backend under a shared BrowserControl contract.
- Memory keeps the existing `MEMORY.md` mechanism and now also has a MemoryV2 store/API with hard L1-L4 promotion rules.
- MemoryV2 exposes L1/L2/L3/L4 through CLI and Settings; L4 summaries are editable evidence files, while raw JSONL sessions remain source archives.
- Skill distillation uses the existing `SKILL.md` format and now has a reviewed-save API for `~/.claude-yh/skills/` / `.claude-yh/skills/`.
- BrowserControl defaults to enabled with wildcard domain access for the current Chrome bridge; denied domains, confirmation, and audit logging remain the safety controls.
- The default real browser route is now the GA-style extension bridge: Chrome connects out to `ws://127.0.0.1:18765`, so existing tabs and cookies stay in the user's current browser. Chrome DevTools launch remains a fallback/debug backend, not the default current-session path.
- `/browser` is the CLI configuration surface. Web and desktop expose the same policy under Settings > Browser.
- Away Runner is now used by scheduled/Jarvis execution paths, not just stored as task metadata.
- Jarvis continuous tasks run only through Away Runner wrapping; observe mode remains checkpoint-only.
- Jarvis companion mode is the productized "小龙虾" always-on path: it can keep processing queued autonomous work, write checkpoints, pause for guarded approvals, and expose control through CLI, desktop/web, and IM adapters.
- MemoryV2 now defaults to the FAISS provider contract. When native Python `faiss` exists it writes a native `vectors.faiss`; otherwise it keeps FAISS metadata plus local semantic search fallback so the feature still works.
- MemoryV2 supports a production OpenAI-compatible embedding provider. DashScope/Bailian defaults to `https://dashscope.aliyuncs.com/compatible-mode/v1` with `text-embedding-v4`; API keys are read only from env/settings and are never returned by the API.
- Jarvis/Away can be installed as a Windows Startup watchdog. The startup entry launches a PowerShell supervisor that restarts the local server after crashes instead of only starting it once.
- Jarvis is now an independent background agent surface: CLI/web/desktop/IM submit goals to a Jarvis planner and queue, instead of using scheduled tasks as the primary abstraction.
- IM inbound messages from Telegram/Feishu/DingTalk/WeCom route into Jarvis by default. Slash-style IM commands still control the Jarvis queue and checkpoints.
- Skill distillation and Memory L4 summarization now prefer the configured main model, with deterministic fallback and a test-only disable flag.
- Cloud Jarvis is a runner protocol: authenticated cloud workers can heartbeat, claim queued work, and report checkpoints/status. It does not make a powered-off local PC run by itself; it gives a remote runner a compatible queue/control surface.

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `apply_patch` could not read old planning files | Replaced previous plan content | Rewrote only `task_plan.md`, `findings.md`, and `progress.md` as UTF-8 planning files |
| Chrome DevTools MCP transport closed | Tried to open the web app through MCP after clearing duplicate profile processes | Switched to an independent Chrome instance with `--remote-debugging-port=9223` and drove the real web UI through CDP |
| CDP smoke against a launched Chrome returned `cdp_connection_closed` | Tried to use remote-debug Chrome as the main BrowserControl path | Re-centered BrowserControl on GA's extension-to-local-WebSocket bridge so current Chrome tabs/cookies are used without opening a separate browser |
| Browser extension page showed an error badge when the local bridge was offline | GA extension logged localhost connection failure with `console.error` | Adapted the extension behavior to warn and retry; added a project-owned extension under `extensions/tmwd_cdp_bridge` |
| CDP wait script timed out after clicking `Run task` | Waited for `6/6 passed` with a malformed regex in the result expression | Re-read the DOM through CDP; the page had completed successfully with `6/6 passed` |
