# claude-yh 能力接口边界

本文记录当前高权限能力和跨端接口的边界。实现细节可能继续演进，但这些产品级约束应保持稳定。

## RustRuntime

- 入口：`src/runtime/`
- Sidecar：`claude-yh-runtime-sidecar`
- 协议：newline-delimited JSON-RPC
- 发现路径：桌面 native binary、`CLAUDE_YH_RUST_SIDECAR_PATH`、`rust/target/debug`、`rust/target/release`
- 当前职责：
  - Bash / PowerShell 权限策略
  - 文件写入安全边界
  - Glob / Grep / 文件搜索
  - Memory / Session 增量索引
  - Jarvis 队列锁和恢复
- 边界：Rust 做加速和安全内核，TypeScript 仍负责 CLI、Web、Desktop、Provider、模型流式输出和业务编排。
- Fallback：Rust 不可用时走 TypeScript fallback，并写诊断日志。

## BrowserControl

- 入口：`src/browserControl/`
- 配置：`~/.claude-yh/settings.json`
- 主要后端：
  - `tmwd-cdp-bridge`
  - `claude-in-chrome` / MCP
  - Chrome DevTools / Playwright fallback
- 默认目标：连接用户当前 Chrome 会话和登录态。
- 可做：tab、DOM、点击、输入、截图、控制台和网络日志。
- 禁止：绕过验证码、2FA、登录风控、支付确认、静默读取敏感凭据。
- 说明：域名 allowlist 不再作为主要产品概念；安全边界以权限模式和高风险动作确认/阻断为准。

## MemoryV2

- 入口：`src/memdir/` 与 `src/services/memoryV2/`
- 存储根：`~/.claude-yh/memory/`
- 分层：
  - L1: `MEMORY.md`
  - L2: `facts/`
  - L3 SOP: `sops/`
  - L3 Skills: `sops/skills/`
  - L4: `sessions/`
- 更新时机：会话关闭、切换、应用退出、空闲超时。
- 抽取方式：模型判断，不靠正则把标题直接写入长期记忆。
- 检索方式：关键词检索和按需读取；不再维护向量库。
- 边界：L4 只能作为证据来源，不能直接污染 L1/L2/L3。

## SkillDistiller

- 目标：把成功经验沉淀为 claude-yh 专属 Skill。
- 保存位置：`~/.claude-yh/memory/sops/skills/`
- 发现方式：Skill listing / discovery 独立注入给模型。
- L1 规则：L1 不重复列出 Skill 元数据，只总结普通 SOP 主题和检索入口。
- 去重规则：同一流程只能进入 SOP 或 Skill 之一。

## Jarvis

- 入口：`src/jarvis/`
- UI：Desktop/Web 的 Jarvis 页面
- CLI：`/jarvis`
- Session：Jarvis 是单一长期对话入口，可通过 `/new` 清空当前会话并备份历史。
- 工作方式：
  - 轻量问答由 Jarvis 主模型直接回答。
  - 完整任务创建一个 Jarvis task。
  - 需要执行复杂工作时启动一个 Manager CLI。
  - Manager CLI 内部使用原生 Todo/Task/Subagent/Tool 系统。
- 状态真源：Jarvis Service。
- 事件源：Manager CLI `stream-json`、定时任务、IM、BrowserControl、记忆系统。
- 日志：
  - `~/.claude-yh/logs/jarvis/tasks/{taskId}.jsonl`
  - `~/.claude-yh/logs/jarvis/managers/{sessionId}.jsonl`

## ChannelAdapter

- 入口：`adapters/common/`
- 当前方向：Telegram、飞书、钉钉等外部消息统一进入 Jarvis。
- 配置：`~/.claude-yh/adapters.json` 和设置界面。
- 边界：IM adapter 只负责收发、鉴权、配对和转发；任务理解与执行由 Jarvis 负责。
- 个人微信：不进入默认发布路径。

