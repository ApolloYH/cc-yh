# claude-yh Rust Runtime Sidecar

This workspace is an opt-in Rust boundary for performance-sensitive runtime
work. It is not used by the main CLI, desktop app, or web server unless a
future integration explicitly routes traffic to it.

## Current Scope

- `crates/runtime-sidecar`: newline-delimited JSON sidecar process.
- `parity-scenarios.json`: current scenario checklist.
- Supported methods:
  - `runtime.hello`
  - `runtime.echo`
  - `session.index`
  - `parity.manifest`

## Commands

```bash
bun run rust:test
bun run rust:check
cargo run --manifest-path rust/Cargo.toml -p claude-yh-runtime-sidecar
```

## Protocol

Each request and response is one JSON object per line.

Request:

```json
{"protocolVersion":1,"id":"1","method":"runtime.hello","params":{}}
```

Success response:

```json
{"protocolVersion":1,"id":"1","ok":true,"result":{}}
```

Failure response:

```json
{"protocolVersion":1,"id":"1","ok":false,"error":{"code":"method_not_found","message":"Unknown claude-yh runtime sidecar method."}}
```

## Activation Boundary

The TypeScript side is disabled by default. Discovery only happens when
`CLAUDE_YH_RUST_SIDECAR_PATH` is explicitly set. The current implementation
does not route any production tool calls through Rust.

`session.index` is read-only. It scans `configDir/projects/*/*.jsonl`,
skips `agent-*.jsonl` sidechain transcripts, and returns bounded metadata for
future session/memory acceleration work.
