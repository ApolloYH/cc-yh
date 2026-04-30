# Memory Implementation

The memory system has four layers, but they are not four independent systems.

## L1

`MEMORY.md` is the compact long-term summary injected into model context. It contains role positioning, long-term user preference summary, L2 topics, L3 SOP topics, and retrieval pointers.

## L2

`facts/` stores long-term facts, preferences, identity, stable configuration, and constraints.

## L3

`sops/` stores reusable SOPs. `sops/skills/` stores claude-yh Skills. A reusable item should be either an SOP or a Skill, not both.

## L4

`sessions/` stores session summaries and provenance. L4 does not directly pollute L1/L2/L3.

## Automation

1. Session close, switch, app exit, or idle timeout triggers finalization.
2. Changed sessions get L4 summaries.
3. The model decides whether L2/L3 promotion candidates exist.
4. Valid candidates are written.
5. L1 is rewritten only if L2/L3 changed.
6. Diagnostic logs record the result.

## Vector Index

The vector database path has been removed. L2/L3 retrieval now uses keyword search and direct file reads for simpler, auditable behavior.
