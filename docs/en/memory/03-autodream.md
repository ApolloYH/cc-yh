# AutoDream Archive Note

AutoDream is an upstream Claude Code memory consolidation idea. It is not the primary memory path in the current claude-yh implementation.

claude-yh currently uses:

- The original memory write flow as the primary system.
- L1-L4 as an enhancement layer, not a parallel memory system.
- No full extraction after every chat turn.
- Session-close, session-switch, app-exit, or idle-time extraction over the whole session.
- L1 as a compact summary and retrieval entry.
- L2 for long-term facts, preferences, identity, and stable rules.
- L3 for reusable SOPs, while claude-yh Skills use their own discovery entry.
- L4 for session summaries and provenance.

Use AutoDream only as background research, not as the current claude-yh runtime behavior.
