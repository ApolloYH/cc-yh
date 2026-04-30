# Memory System

claude-yh keeps one long-term memory system and structures it into L1-L4.

- L1: compact startup summary in `MEMORY.md`.
- L2: durable facts and preferences in `facts/`.
- L3: reusable SOPs in `sops/`, with Skills in `sops/skills/`.
- L4: session summaries and provenance in `sessions/`.

The system updates after session close, session switch, app exit, or idle timeout. One-off task results remain in L4 unless the model determines they have durable reuse value.
