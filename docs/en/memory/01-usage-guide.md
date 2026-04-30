# Memory Usage Guide

claude-yh maintains one long-term memory system. The original memory flow remains the primary system, and L1-L4 is a structured enhancement layer.

## Storage

```text
~/.claude-yh/memory/
  MEMORY.md        # L1 compact summary
  facts/           # L2 long-term facts and preferences
  sops/            # L3 reusable SOPs
  sops/skills/     # claude-yh Skills
  sessions/        # L4 session summaries and provenance
```

Project transcripts remain under:

```text
~/.claude-yh/projects/
```

## Update Policy

- No full extraction after every chat turn.
- Extraction runs on session close, session switch, app exit, or idle timeout.
- If an L4 summary is newer than the source transcript, extraction is skipped.
- L1 is rewritten only when L2/L3 changes.
- Skills use their own discovery/listing path and are not summarized into L1.

## Promotion Rules

L2 stores durable facts and preferences. L3 stores reusable procedures. One-off searches, weather snapshots, hot lists, and temporary questions stay in L4 only.

## Provenance

New L2/L3 files keep source metadata. Follow the `Source` field to the related L4 summary or raw session JSONL when auditing memory.
