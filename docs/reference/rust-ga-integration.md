
# Rust 与 GenericAgent 能力吸收边界

本文记录 `claude-yh` 从 `claw-code` 和 `GenericAgent` 吸收能力时的落地边界。

## 第一阶段已落地

- `/skillify` 对普通 `claude-yh` 用户开放，用于把已经验证过的会话流程沉淀成 `SKILL.md`。
- `/remember` 对普通用户开放，但仍受 `autoMemoryEnabled` 控制，只提出记忆整理建议，不直接改文件。
- 记忆提示加入 L1-L4 分层模型：
  - L1: `MEMORY.md`，只放一行索引指针。
  - L2: typed memory files，保存稳定事实、偏好、项目上下文、外部引用。
  - L3: Skills/SOPs，保存已验证的可复用流程。
  - L4: raw sessions/logs/transcripts，只作为检索和再整理证据。
- 记忆和技能沉淀统一遵守 “No execution, no memory”：没有工具结果或用户明确确认，不把猜测提升为长期记忆或自动化流程。

## Rust 迁移边界

Rust 只进入窄边界，不替换主 agent loop：

- 优先候选：文件检索、会话/记忆索引、权限判定、命令解析、mock parity harness。
- 不直接迁移：模型循环、TUI/React UI、provider 兼容层、MCP 生命周期、现有设置加载链。
- 每个 Rust sidecar 都必须有 JSON 协议、TS fallback、parity test、错误降级路径。
- `claw-code` 的价值是模块化和 parity harness 方法，不是一次性全量重写。

## 第二阶段已落地

仓库新增了一个禁用默认启用的 Rust runtime sidecar 骨架：

- Rust workspace: `rust/Cargo.toml`
- Sidecar crate: `rust/crates/runtime-sidecar`
- TypeScript protocol/client: `src/runtime/rustSidecarProtocol.ts`、`src/runtime/rustSidecarClient.ts`
- Reusable parity harness: `src/runtime/rustParityHarness.ts`
- Scenario manifest: `rust/parity-scenarios.json`

当前 sidecar 只支持三个安全方法：

- `runtime.hello`: 返回 sidecar 名称、协议版本和 capability 列表。
- `runtime.echo`: 原样返回结构化 JSON 参数，用于验证协议 roundtrip。
- `parity.manifest`: 返回当前 parity 场景清单。

启用边界：

- 默认不启用，不影响 CLI、桌面端、Web 端。
- 只有显式设置 `CLAUDE_YH_RUST_SIDECAR_PATH` 时，TS 侧才会发现 sidecar。
- 当前没有任何生产工具调用路由到 Rust。

验证命令：

```bash
bun test src/runtime/__tests__/rustSidecarProtocol.test.ts src/runtime/__tests__/rustSidecarClient.test.ts
bun run rust:test
```

## 浏览器能力边界

GenericAgent 的 `tmwd_cdp_bridge` 类能力只能作为显式启用的浏览器后端接入：

- 必须有用户安装/启用动作，不能静默启用。
- 必须暴露能力清单和风险说明，尤其是 cookies、tabs、debugger、CSP 修改等权限。
- 必须保留域名 allowlist、审计日志、敏感动作确认。
- 不处理或绕过验证码、登录、2FA、支付、风控验证；遇到这些情况必须交还用户。
- 现有 MCP/Chrome/browser-control 能力保留，新增后端只能挂在统一 BrowserControl 合约后面。

## 第三阶段已落地

仓库新增了 `src/browserControl/` 安全合约骨架：

- `types.ts`: 定义 backend、capability、action、policy、decision。
- `backends.ts`: 描述现有/候选后端：
  - `claude-in-chrome`
  - `computer-use`
  - `tmwd-cdp-bridge`
- `policy.ts`: 统一策略判断。

当前策略规则：

- 默认禁用全部浏览器自动化。
- 只有域名命中 `allowedDomains` 时才允许执行。
- `deniedDomains` 优先级高于 `allowedDomains`。
- 点击、输入、上传、下载、cookie/CDP/headers/extension 管理等敏感动作必须确认。
- captcha、2FA、payment、sensitive confirmation 永远交还用户。
- `tmwd-cdp-bridge` 是高风险后端；必须显式允许高风险后端。
- cookie/CDP/headers/extension 管理是高风险 capability；必须另行显式允许。

这一步没有接入真实浏览器后端，也没有改变现有 Chrome MCP / Computer Use 路径。

验证命令：

```bash
bun test src/browserControl/__tests__/policy.test.ts
bun x tsc --noEmit -p tsconfig.json
```

## 第四阶段已落地

仓库新增了钉钉和企业微信的低风险 adapter 扩展骨架：

- `adapters/common/platform.ts`: 统一 IM 平台类型，包含 `telegram`、`feishu`、`dingtalk`、`wecom`。
- `adapters/common/config.ts`: 读取 `adapters.json` 中的 `dingtalk` / `wecom` 配置，并支持环境变量覆盖密钥。
- `src/server/services/adapterService.ts`: 服务端配置读写支持 `dingtalk` / `wecom`，并对 webhook、secret、key 等敏感字段脱敏和保留。
- `src/server/api/adapters.ts`: 配置 API 允许保存 `dingtalk` / `wecom` 顶层节点。
- `desktop/src/types/adapter.ts` 和 `desktop/src/stores/adapterStore.ts`: 桌面端配置类型支持新增平台。
- `adapters/dingtalk/webhook.ts`: 钉钉机器人签名 URL 和 markdown 消息体构造。
- `adapters/wecom/webhook.ts`: 企业微信机器人 URL、text 和 markdown 消息体构造。

这一阶段没有启动真实长连接、没有新增后台 sidecar、没有改变现有 Telegram / 飞书通知链路。新增内容只作为后续真实接入的配置和纯函数基础。

验证命令：

```bash
bun test adapters/common/__tests__/config-channels.test.ts adapters/dingtalk/__tests__/webhook.test.ts adapters/wecom/__tests__/webhook.test.ts src/server/__tests__/adapter-service.test.ts
bun x tsc --noEmit -p tsconfig.json
cd desktop && bun run lint
```

## 第五阶段已落地

仓库新增了 `src/awayRunner/` 自主执行安全合约：

- `types.ts`: 定义 mode、risk、budget、checkpoint、pause reason、run state、decision。
- `policy.ts`: 提供默认禁用配置、配置归一化、执行判定。
- `src/server/services/cronService.ts`: 定时任务可选保存 `awayRunner` 配置。
- `desktop/src/types/task.ts`: 桌面端任务类型可携带 `awayRunner` 配置。

当前 Away Runner 不会自动接管现有定时任务，也不会改变 scheduler 行为。它只是把“离开后是否能继续执行”的规则从自然语言沉淀成可测试合约。

验证命令：

```bash
bun test src/awayRunner/__tests__/policy.test.ts src/server/__tests__/scheduled-tasks.test.ts
bun x tsc --noEmit -p tsconfig.json
```

## 第六阶段已落地

仓库新增了只读 session index 加速边界：

- TypeScript fallback: `src/runtime/sessionIndex.ts`
- Rust sidecar method: `session.index`
- Parity harness 场景: `session_index_smoke`

`session.index` 只扫描 `configDir/projects/*/*.jsonl` 的会话元数据，跳过 `agent-*.jsonl` sidechain 文件，返回 session id、项目目录、文件路径、时间、消息数和标题。它不会写入记忆，也不会替换现有 session/memory 读取路径。

验证命令：

```bash
bun test src/runtime/__tests__/sessionIndex.test.ts src/runtime/__tests__/rustSidecarProtocol.test.ts src/runtime/__tests__/rustSidecarClient.test.ts
bun run rust:test
```

## 渠道接入顺序

- 已有：Telegram、飞书。
- 优先新增：钉钉、企业微信。
- 谨慎处理：个人微信。它有账号风控、协议稳定性和合规风险，不作为第一批目标。

## 后续阶段

1. 建 Rust sidecar JSON 协议和 mock parity harness 骨架。
2. 建 BrowserControl 抽象和 capability policy。
3. 增加真实钉钉/企业微信适配器进程，共用现有 adapter common 层。
4. 增加 Away Runner：预算、检查点、暂停条件、人工确认。
5. 尝试 Rust 加速 session/memory index，保留 TS fallback。
