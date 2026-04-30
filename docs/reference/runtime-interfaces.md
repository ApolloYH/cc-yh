# claude-yh 能力接口边界

本文记录 RustRuntime、BrowserControl、MemoryV2、SkillDistiller、ChannelAdapter、AwayRunner 的当前合约。所有高权限能力默认不自动启用。

## RustRuntime

- 入口：`src/runtime/rustSidecarClient.ts`
- 协议：newline-delimited JSON，版本号 `protocolVersion: 1`
- 启用：只有显式设置 `CLAUDE_YH_RUST_SIDECAR_PATH` 时才发现 sidecar
- 当前方法：
  - `runtime.hello`
  - `runtime.echo`
  - `session.index`
  - `parity.manifest`
- 边界：Rust 只做可替换加速内核，不替换 CLI、desktop、web 的 TypeScript 业务层
- 替换规则：Rust 行为必须先通过 TS fallback、mock parity harness、真实回归测试

## BrowserControl

- 入口：`src/browserControl/`
- 后端描述：
  - `claude-in-chrome`
  - `computer-use`
  - `tmwd-cdp-bridge`
- 默认：禁用
- 必须：域名 allowlist、敏感动作确认、高风险 backend 显式允许
- 禁止：验证码、2FA、支付、敏感确认、绕过登录或风控

## MemoryV2

- 入口：`src/memdir/memoryTypes.ts`
- 分层：
  - L1: `MEMORY.md` / index，只放指针和红线
  - L2: typed facts，保存稳定事实、偏好、项目规则
  - L3: Skills/SOPs，保存验证过的可复用流程
  - L4: sessions/logs/transcripts，保存原始证据和检索索引
- 提升规则：L4 不能直接污染 L1/L2；只有验证过的经验才能提升到 L2/L3

## SkillDistiller

- 入口：`src/skills/bundled/skillify.ts`
- 目标：把成功会话沉淀为候选 `SKILL.md`
- 边界：生成候选，不自动写入；失败经验不能当能力沉淀
- 保存位置：用户级 `~/.claude-yh/skills/` 或项目级 `.claude-yh/skills/`

## ChannelAdapter

- 入口：`adapters/common/`
- 已有：Telegram、飞书
- 骨架：钉钉、企业微信
- 当前边界：钉钉/企业微信只接了配置、脱敏、webhook helper，尚未接真实长连接或通知发送路径
- 个人微信：实验方向，不进入默认发布路径

## AwayRunner

- 入口：`src/awayRunner/`
- 默认：禁用
- 模式：
  - `observe`: 只观察，不继续执行
  - `assisted`: 需要人类确认关键继续点
  - `autonomous`: 在预算和风险范围内可继续执行
- 强制边界：预算、checkpoint、暂停条件、风险等级
- 暂停条件：用户决策、敏感动作、浏览器人类专属流程、外部 API、密钥访问、破坏性文件操作、工作区不干净、测试失败、未知错误、预算耗尽
