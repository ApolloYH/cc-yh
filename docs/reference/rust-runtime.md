# Rust Runtime

claude-yh 使用 Rust 做高收益加速内核，不做全量重写。上层交互、模型调用、桌面端和 Web 端仍由 TypeScript 负责；Rust 负责更适合做成硬边界和高性能扫描的模块。

## 当前 Rust 化范围

| 模块 | 作用 |
| ---- | ---- |
| Bash / PowerShell 权限策略 | 判断命令风险、是否允许、是否需要确认 |
| 文件写入安全边界 | 路径规范化、越界检查、Windows 特殊路径和 traversal 防护 |
| Glob / Grep / 文件搜索 | 大目录扫描和文本搜索优先走 Rust，TS fallback 兜底 |
| Memory / Session 索引 | 增量扫描会话和记忆文件，减少大历史下的重复读取 |
| Jarvis 队列锁和恢复 | 原子 claim、崩溃恢复、防止多进程重复执行 |

## 接入方式

Rust runtime 以 sidecar 方式运行，TypeScript 通过 newline-delimited JSON-RPC 调用。

常见路径：

```text
desktop/src-tauri/binaries/native/win32-x64/claude-yh-runtime-sidecar.exe
rust/target/debug/claude-yh-runtime-sidecar.exe
rust/target/release/claude-yh-runtime-sidecar.exe
```

开发构建：

```bash
cargo build --manifest-path rust/Cargo.toml --bin claude-yh-runtime-sidecar
bun run desktop/scripts/build-sidecars.ts
```

## Fallback 规则

Rust 是优先路径，但不是唯一生路：

- Rust sidecar 可用时，相关模块优先走 Rust。
- Rust sidecar 不存在、启动失败或方法不可用时，TypeScript fallback 会兜底。
- 诊断日志会记录 `source=rust` 或 fallback 原因，方便排查是否降级。

## 日志

Rust 相关诊断写入：

```text
logs/rust-runtime/*.jsonl
~/.claude-yh/logs/diagnostics/*.jsonl
```

重点看：

- `runtime.sidecar request ok=true`
- `jarvis.queue recover source=rust`
- `session.index.incremental ok=true`
- `sidecar unavailable`
- `method_not_found`

## Windows 杀毒误报

部分杀毒软件可能误报 Rust 编译产物，例如把 `rust/target/debug/deps/*.exe` 识别成后门。这个通常是 Rust debug/test 产物被启发式规则误杀，不代表源码里存在 Meterpreter。

建议：

- 给本地仓库或 `rust/target/` 加信任。
- 发布版使用 `desktop/src-tauri/binaries/native/.../claude-yh-runtime-sidecar.exe`。
- 开源分发时保留 `rust/` 源码，让用户本机自行构建。

## 为什么不全量 Rust 重写

上层交互和业务逻辑继续 TS 更稳：

- CLI、Ink、React、Tauri sidecar、Provider、WebSocket 和工具协议都已经在 TS 中成熟。
- 模型流式输出、UI 状态和 IM 适配器变化快，TS 迭代成本更低。
- Rust 更适合放在安全边界、索引、搜索和队列锁这些“硬内核”位置。

因此当前策略是：Rust 做核心加速和安全边界，TS 负责产品逻辑和用户体验。

