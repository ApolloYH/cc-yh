# Codex 交接文档：cc-yh 项目二开状态

本文档用于新开 Codex / AI 对话后快速恢复上下文。请优先阅读本文件，再继续开发。当前项目路径是：

`C:\Users\y1513\Desktop\cc\cc-yh`

不要误用历史上下文里出现过的 `C:\Users\y1513\Desktop\cc-haha`，除非用户明确要求切换。

## 1. 项目定位

`cc-yh` 是一个 Claude Code 平行版 / 二开版项目，目标是：

- 终端命令使用 `claude-yh`，避免和官方 `claude` 命令混淆。
- Web 端和桌面端都能连接同一套本地服务。
- 同时兼容：
  - Anthropic Messages 格式。
  - OpenAI compatible Chat Completions 格式。
  - OpenAI compatible Responses 格式。
- 支持 LiteLLM 以外的直接 OpenAI-compatible 接入，不强依赖 LiteLLM。
- 支持 MiniMax 等服务商配置。
- 支持 IM adapter，例如 Telegram / 飞书，当前 Telegram 已能运行。
- 支持 skills 管理、历史会话、目录选择、使用统计、模型计费、桌面壳打包。

用户偏好：

- 用户使用中文，希望直接修，不喜欢反复提问。
- 用户要求所有 UI 尽量中文化。
- 用户希望桌面端体验更像成熟桌面 App，并参考 `cc-switch`、ChatGPT 桌面 / Web 的丝滑交互与配色。
- 用户非常重视功能实测，不接受只跑 `tsc` 就说完成。

## 2. 当前重要结论

### 2.1 配置来源

此前讨论过配置文件“为什么两层”。当前目标是尽量统一使用 `~/.claude-yh` 作为用户配置目录，Web / Desktop / CLI 都应读取同一套配置，避免一个地方设置了服务商，另一个地方不生效。

需要重点确认这些位置：

- `src/server/services/sessionService.ts`
- `src/server/api/status.ts`
- `desktop/src/api/*`
- 桌面 sidecar 启动脚本：`desktop/scripts/build-sidecars.ts`
- Tauri Rust 侧：`desktop/src-tauri/src/lib.rs`

### 2.2 OpenAI / Anthropic 兼容

用户明确要求“同时兼容 OpenAI 格式和 Anthropic 格式”。不要把 Anthropic provider 强行按 OpenAI compatible 调用，也不要把 OpenAI compatible 强行当原生 Anthropic。

此前出现过错误：

```text
OpenAI compatible request failed with status 404: nginx 404
```

原因通常是：

- provider 协议选错，例如 Anthropic endpoint 被走了 OpenAI chat completions 路径。
- baseUrl 不匹配，例如 `/v1/chat/completions`、`/v1/responses`、`/anthropic/v1/messages` 的拼接错误。
- UI 服务商新增时没有允许用户改 `baseUrl` / 协议 / compat mode。

后续如果继续修 provider，要检查：

- UI 中新增服务商必须允许编辑：协议、baseUrl、model、api key、headers、compat mode。
- 后端调用前必须按 provider.protocol 或 compatMode 分流。
- 错误提示要展示最终请求路径，方便用户定位 404。

## 3. 近期已完成的大块功能

以下内容来自当前会话和上一段对话的工作状态，文件有大量未提交改动，请不要随意 revert。

### 3.1 桌面浅色主题

目标：从暖米黄色改为更接近 OpenAI 官网风格的中性灰白。

关键文件：

- `desktop/src/theme/globals.css`
- `desktop/index.html`
- `desktop/src/pages/EmptySession.tsx`
- `desktop/src/components/chat/ChatInput.tsx`
- `desktop/src/pages/ScheduledTasks*.tsx`

修改方向：

- 页面主背景中性灰白。
- 卡片白色 / 近白。
- 边框浅灰。
- 阴影更轻。
- 保留当前品牌强调色，不做 OpenAI 1:1 仿站。

### 3.2 Logo / App Icon

用户要求把网站 icon 和 logo 替换为自己的 SVG。

曾用过的源文件：

- `file:///C:/Users/y1513/Downloads/option_a_sunburst_icon.svg`
- 旧需求里也出现过 `C:/Users/y1513/Desktop/LAW-FRONT/logo/svg/04_logo_icon.svg`

需要继续检查：

- `desktop/public/app-icon.svg`
- `desktop/index.html`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/tauri.windows.conf.json`
- Web favicon / title 是否都是 Claude YH。

### 3.3 Web / Desktop 启动方式

用户要求 README 里写清楚。

常用命令：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh
bun install
bun run src/server/index.ts
```

Web 前端通常是：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
bun run dev
```

桌面端 Tauri：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
bun install
bun run tauri dev
```

打包 exe：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
bun run tauri build
```

注意：Tauri 需要 Rust / Cargo。如果报：

```text
failed to run cargo metadata: program not found
```

说明本机没装 Rust，需安装 Rust stable。

如果报 Tauri build script `PermissionDenied`，此前多发生在 Windows 目标目录 / target 缓存 / 杀软占用，要尝试关闭占用、清 target 或重启后再跑。

### 3.4 端口占用

后端默认端口经常是 `3456`，桌面 Tauri 会启动随机本地端口，例如日志里出现过：

```text
Claude Code API server running at http://127.0.0.1:61827
```

如果手动跑：

```text
EADDRINUSE
```

说明已有服务占用端口。不要重复启动。可用 PowerShell 查：

```powershell
Get-NetTCPConnection -LocalPort 3456 | Select-Object OwningProcess
```

然后确认后再停对应进程。

### 3.5 Telegram adapter

用户已经跑通过 Telegram：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\adapters
bun install
bun run telegram
```

日志示例：

```text
[Telegram] Starting bot...
[Telegram] Server: ws://127.0.0.1:3456
[Telegram] Bot is running!
```

桌面 Tauri 启动时 sidecar 也会启动 adapter，日志示例：

```text
[claude-adapters] [Config] Using Windows system proxy: http://127.0.0.1:7897
[claude-adapters] [claude-sidecar] starting Telegram adapter
[claude-adapters] [Telegram] Bot: @apolloyh_bot
```

如果飞书缺环境变量，会跳过：

```text
--feishu requested but FEISHU_APP_ID / FEISHU_APP_SECRET missing
```

### 3.6 工作目录胶囊

用户要求：

- 工作目录选择胶囊放在顶部左上角，参考 ChatGPT 左上角大字区域。
- 不是侧边栏里的左上角。
- 可以点击并选择电脑任意位置目录。
- 新建对话也要保持顶部胶囊位置，不要回到底部。
- 选择目录后，应改变这个对话的启动目录。
- 最近打开目录不要错误显示 GitHub 图标。

相关文件可能包括：

- `desktop/src/components/layout/TabBar.tsx`
- `desktop/src/pages/EmptySession.tsx`
- `desktop/src/pages/ActiveSession.tsx`
- `desktop/src/stores/*`
- `src/server/services/sessionService.ts`

历史日志显示目录启动是按 workDir 生效的：

```text
handleUserMessage: resolved workDir="C:\Users\y1513\Downloads"
Starting CLI ... cwd: C:\Users\y1513\Downloads
```

### 3.7 侧边栏历史对话管理

用户要求：

- 原来垃圾桶删除图标改为三个点。
- 悬停 / 点击三个点显示菜单：
  - 删除对话
  - 置顶对话
  - 导出对话，支持 JSON 导出
  - 批量管理
- 垃圾桶图标大小曾多次调整，用户最终不满意，因此改三点是最终方向。

相关文件：

- `desktop/src/components/layout/Sidebar.tsx`
- `desktop/src/stores/tabStore.ts` 或相关 session store
- `desktop/src/types/session.ts`

### 3.8 Skills 管理

用户要求：

- Web 端和桌面端的 skills 不只是能看，还能手动安装和管理。
- 类似“小龙虾”那种方便的 skills 管理。
- 支持像 claudate 这种命令式安装：
  - 用户给过链接：`https://claudate.com/zh/package/async-python-patterns-mi0sl0gx`
  - 但我们的启动命令是 `claude-yh`。

需要确认：

- 当前 UI 是否已能新增 skills。
- 是否支持从 URL / package spec 安装。
- 是否调用 `claude-yh skill install ...` 或内部等价安装逻辑。

### 3.9 使用统计 / Token / 计费

用户要求增加 token 使用情况统计和模型计费，参考 `cc-switch`。

关键文件：

- `src/server/api/status.ts`
- `src/server/services/modelPricingService.ts`（新文件，当前未跟踪）
- `desktop/src/api/usage.ts`
- `desktop/src/pages/UsageSettings.tsx`

UI 统计要求：

- 总 Token 显示不要括号里的输入 / 输出明细，例如不要 `Token 20,339（输入 20,312 / 输出 27）`，只显示总量。
- 设置页增加“使用统计”。
- 趋势折线图横轴要跟选择的时间范围走，不要只显示一个小时。
- 要绘制多条线：
  - 成本
  - 缓存创建
  - 缓存命中
  - 输入
  - 输出
- 不同颜色区分。
- 鼠标放在线上显示详细 tooltip，类似 `cc-switch`。
- 模型计费表可折叠。
- 请求日志卡片列：
  - 时间
  - 供应商
  - 计费模型
  - 输入
  - 输出
  - 总成本
  - 用时/首字
  - 状态
  - 来源
- Provider 统计和模型统计参考 cc-switch 的一行请求日志风格。
- 最近请求曾出现重复，需要注意去重。
- 当前无法得到缓存 token 的问题需要继续核实：上游返回 usage 是否包含 cache creation / cache read。

最近一次修复内容：

- `desktop/src/pages/UsageSettings.tsx:299`
  - 修了图表“负值”问题：数据先 `Math.max(0, selector(item))`，SVG y 坐标 `clamp(10, 92)`。
- `desktop/src/pages/UsageSettings.tsx:488`
  - 增加 `clamp()`。
- smooth Bézier 控制点限制在相邻点范围内，防止曲线过冲到图表下方。

注意：如果图表仍不够丝滑，可继续改为 monotone cubic interpolation，避免 Catmull-Rom 过冲。

### 3.10 启动窗口 / 桌面体验

用户不满意 Tauri 启动慢和窗口变化不丝滑。

当前相关文件：

- `desktop/src/components/layout/AppShell.tsx`
- `desktop/src-tauri/src/lib.rs`
- `desktop/src-tauri/capabilities/default.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/tauri.windows.conf.json`

已做过的事：

- 启动时先显示较小长方形 splash，而不是大窗口白屏。
- splash 只显示 logo，不显示文字说明。
- logo 比原先大一号。
- `lib.rs` 里本地 server 用 `spawn_blocking` 后台启动，避免阻塞 Tauri setup。
- `get_server_url` 等待 server ready，最长约 20s。
- `capabilities/default.json` 加了窗口权限，例如：
  - `core:window:allow-center`
  - `core:window:allow-is-maximized`
  - `core:window:allow-set-focus`
  - `core:window:allow-set-min-size`
  - `core:window:allow-set-size`
  - `core:window:allow-show`
  - `core:window:allow-unmaximize`

最近一次修复：

- `desktop/src/components/layout/AppShell.tsx:21`
  - `APP_EXPAND_DURATION_MS = 520`
- `desktop/src/components/layout/AppShell.tsx:87`
  - 改成 `easeInOutCubic`
- `desktop/src/components/layout/AppShell.tsx:118`
  - 限制到约 45fps
- 动画过程中不再每帧 `center()`，只结束后居中，减少抖动。

如果用户仍觉得“变大动画难受”，下一步建议：

1. 不再从前端每帧调用 `win.setSize()`，因为 JS -> Tauri IPC 每帧可能天然不顺。
2. 改成 Rust/Tauri 侧原生命令控制窗口动画，或使用 Windows 原生 API。
3. 或者折中：窗口一次性跳到最终尺寸，但内容做更丝滑的 scale/opacity 过渡，这通常比跨进程改窗口尺寸更稳定。

### 3.11 最小窗口尺寸 / 布局稳定

用户发现窗口缩小时图标关系乱，全屏和最小化按钮会被遮挡。

目标：

- 设置最小窗口宽高，避免布局压坏。
- 顶部窗口控制按钮应随着窗口左移 / 右移正确响应，不被内容盖住。
- 缩小时保证关键布局比例正确。

相关文件：

- `desktop/src/components/layout/WindowControls.tsx`
- `desktop/src/components/layout/AppShell.tsx`
- `desktop/src/theme/globals.css`
- `desktop/src-tauri/tauri*.conf.json`

### 3.12 定时任务运行按钮图标

用户要求把运行按钮横向箭头换成竖向。

最近一次已改：

- `desktop/src/components/tasks/TaskRow.tsx:109`
  - `play_arrow` -> `arrow_upward`

## 4. 最近一次验证结果

最近一次命令：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh
bun x tsc --noEmit -p desktop\tsconfig.json
git diff --check -- desktop/src/pages/UsageSettings.tsx desktop/src/components/layout/AppShell.tsx desktop/src/components/tasks/TaskRow.tsx
```

结果：通过。

此前更大范围验证曾通过：

```powershell
bun x tsc --noEmit -p desktop\tsconfig.json
bun x tsc --noEmit -p tsconfig.json
bun test desktop\src\__tests__\pages.test.tsx src\server\__tests__\e2e\business-flow.test.ts src\server\__tests__\e2e\full-flow.test.ts
```

结果曾是：`116 pass / 0 fail`。

更早还跑过：

```powershell
bun test
```

结果曾是：`851 pass / 0 fail`。

注意：这些结果是历史状态，不代表当前所有未提交改动后仍全量通过。新会话如果继续开发，建议重新跑。

## 5. 当前 Git 状态概览

当前有大量未提交修改，不要随意重置。最近 `git status --short` 显示包括：

```text
 M desktop/index.html
 M desktop/scripts/build-sidecars.ts
 M desktop/src-tauri/capabilities/default.json
 M desktop/src-tauri/src/lib.rs
 M desktop/src-tauri/tauri.conf.json
 M desktop/src-tauri/tauri.windows.conf.json
 M desktop/src/__tests__/pages.test.tsx
 M desktop/src/api/usage.ts
 M desktop/src/components/chat/ChatInput.tsx
 M desktop/src/components/chat/MessageList.test.tsx
 M desktop/src/components/controls/ModelSelector.tsx
 M desktop/src/components/controls/PermissionModeSelector.tsx
 M desktop/src/components/layout/AppShell.tsx
 M desktop/src/components/layout/ContentRouter.tsx
 M desktop/src/components/layout/Sidebar.tsx
 M desktop/src/components/layout/TabBar.tsx
 M desktop/src/components/layout/WindowControls.tsx
 M desktop/src/components/tasks/TaskRow.tsx
 M desktop/src/pages/EmptySession.tsx
 M desktop/src/pages/UsageSettings.tsx
 M desktop/src/test/setupDom.ts
 M desktop/src/theme/globals.css
 M desktop/src/types/chat.ts
 M desktop/src/types/session.ts
 M src/server/__tests__/cron-scheduler.test.ts
 M src/server/__tests__/teams.test.ts
 M src/server/api/status.ts
 M src/server/services/sessionService.ts
?? src/server/services/modelPricingService.ts
```

## 6. 重要代码位置索引

### 6.1 桌面壳 / 启动

- `desktop/src-tauri/src/lib.rs`
  - Tauri setup。
  - 本地 server / sidecar 启动。
  - `get_server_url` 等待 server ready。
- `desktop/src-tauri/capabilities/default.json`
  - Tauri v2 权限。
  - 窗口 API 不生效时优先检查这里。
- `desktop/src/components/layout/AppShell.tsx`
  - React app 启动 bootstrap。
  - splash UI。
  - ready 后窗口尺寸调整 / 动画。

### 6.2 布局

- `desktop/src/components/layout/Sidebar.tsx`
  - 左侧历史对话、导航、折叠。
- `desktop/src/components/layout/TabBar.tsx`
  - 顶部栏、工作目录胶囊可能在这里。
- `desktop/src/components/layout/WindowControls.tsx`
  - Windows 自定义窗口按钮。
- `desktop/src/components/layout/ContentRouter.tsx`
  - 页面切换，已加过轻量 page transition。

### 6.3 聊天

- `desktop/src/components/chat/ChatInput.tsx`
  - 输入区、发送按钮、模型/权限选择位置。
- `desktop/src/components/chat/MessageList.tsx`
  - 消息列表。
- `desktop/src/stores/chatStore.ts`
  - WebSocket 连接、消息状态、发送消息。
- `src/server/index.ts`
  - WebSocket server。
- `src/server/services/sessionService.ts`
  - 会话工作目录、CLI spawn、usage 记录等。

### 6.4 Provider / 模型配置

- `desktop/src/components/controls/ModelSelector.tsx`
- `desktop/src/components/controls/PermissionModeSelector.tsx`
- `desktop/src/pages/Settings.tsx`
- `src/server/types/provider.ts`
- `src/server/proxy/transform/anthropicToOpenaiChat.ts`
- `src/server/proxy/transform/anthropicToOpenaiResponses.ts`

### 6.5 使用统计

- `desktop/src/pages/UsageSettings.tsx`
  - 设置页使用统计 UI。
  - summary 卡片、趋势图、tooltip、请求日志、Provider 统计、模型统计、计费表。
- `desktop/src/api/usage.ts`
  - 前端 usage API 类型和调用。
- `src/server/api/status.ts`
  - 后端 usage detail / trends / logs / provider stats / model stats。
- `src/server/services/modelPricingService.ts`
  - 模型计费配置服务，当前未跟踪，需要检查是否应加入版本控制。

### 6.6 定时任务

- `desktop/src/components/tasks/TaskRow.tsx`
  - 任务行、运行按钮、日志按钮、确认弹窗。
- `desktop/src/components/tasks/TaskRunsPanel.tsx`
  - 任务运行日志。
- `src/server/__tests__/cron-scheduler.test.ts`
  - cron 测试。

## 7. 当前用户最关心的问题清单

新会话接手后，优先关注这些：

1. 桌面启动窗口放大动画是否仍然不丝滑。
   - 如果仍不丝滑，优先考虑 Rust 原生动画或取消窗口尺寸动画，只做内容过渡。
2. 使用统计曲线是否还有负值 / 过冲。
   - 已做 clamp，但需要真实 UI 验证。
3. 当天范围是否完整显示横轴，而不是只有一个点。
   - `src/server/api/status.ts` 里 today range 应到当天 `23:59:59.999`。
4. 使用统计 tooltip 是否像 cc-switch 一样好用。
5. 最近请求是否重复。
6. 缓存 token 是否能正确统计。
7. 新增服务商是否支持完整编辑协议 / baseUrl / compat mode。
8. OpenAI / Anthropic 是否都能实际通。
9. skills 是否能从 URL / 命令式安装。
10. 历史对话三点菜单是否完成删除 / 置顶 / JSON 导出 / 批量管理。

## 8. 建议下一轮测试流程

### 8.1 静态检查

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh
bun x tsc --noEmit -p desktop\tsconfig.json
bun x tsc --noEmit -p tsconfig.json
```

### 8.2 单元 / 集成测试

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh
bun test
```

如果全量太慢，可先跑：

```powershell
bun test desktop\src\__tests__\pages.test.tsx src\server\__tests__\e2e\business-flow.test.ts src\server\__tests__\e2e\full-flow.test.ts
```

### 8.3 桌面真实测试

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
bun run tauri dev
```

检查：

- splash 是否是长方形。
- splash 是否只显示 logo。
- ready 后是否自动展开到合适窗口。
- 动画是否自然，不要“突然变大”或抖动。
- 缩小窗口时布局是否保持稳定。
- 顶部窗口控制按钮是否不被遮挡。
- 侧边栏折叠 / 展开是否正常。
- 工作目录胶囊是否在顶部左上角并可点击选择目录。
- 新对话是否保留顶部胶囊位置。
- 选择目录后发消息，后端日志里的 `cwd` 是否是所选目录。

### 8.4 Provider 实测

至少测两类：

1. OpenAI compatible Chat Completions：
   - `CLAUDE_CODE_COMPAT_PROVIDER=openai`
   - `CLAUDE_CODE_OPENAI_COMPAT_MODE=chat_completions`
2. Anthropic Messages：
   - MiniMax Anthropic endpoint 示例曾是：
     - `ANTHROPIC_BASE_URL=https://api.minimax.com/anthropic`
     - `ANTHROPIC_MODEL=MiniMax-M2.7`

注意不要泄露用户 `.env` 里的真实 token。历史对话里出现过 token，后续回答不要复述。

## 9. 编码注意事项

- 用户要求直接修，不要把问题推回给用户。
- 但涉及真实 token、外部账号、OAuth 时，不要泄露密钥，不要复制 `.env` 里的 token 到回答或文档。
- 不要改坏官方兼容的真实 URL / OAuth endpoint / 下载 endpoint。
- `claude` 文案大多要改为 `claude-yh` / `Claude YH`，但协议名、历史内部标识、外部官方 URL 不能乱改。
- 不要使用 `git reset` 或大范围 revert。
- 修改外部路径需要注意沙箱权限。
- Windows PowerShell 写文件容易带 BOM 或 CRLF 差异，写完建议跑：

```powershell
git diff --check
```

## 10. 最近一次具体修改详情

### 10.1 使用统计曲线负值

文件：`desktop/src/pages/UsageSettings.tsx`

关键修改：

- `pointsFor()` 中：
  - 把 selector 返回值限制为非负。
  - y 坐标限制在图表范围内。
- `smoothPath()` 中：
  - 控制点 `cp1y` / `cp2y` 限制在当前点和下一个点之间，防止 Bézier 曲线过冲。
- 新增：

```ts
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
```

### 10.2 启动窗口动画

文件：`desktop/src/components/layout/AppShell.tsx`

关键修改：

- 动画时长：`APP_EXPAND_DURATION_MS = 520`
- easing：`easeInOutCubic`
- 约 45fps 节流。
- 动画过程中只 `setSize()`，结束后再 `center()`。
- 保留延后矫正最终尺寸，避免 Tauri webview 初始化时尺寸没应用。

如果继续优化，建议把窗口尺寸动画迁移到 Rust/Tauri 侧，避免 JS IPC 每帧调用带来的卡顿。

### 10.3 运行按钮图标

文件：`desktop/src/components/tasks/TaskRow.tsx`

关键修改：

```tsx
{isRunning ? 'sync' : 'arrow_upward'}
```

## 11. 新会话建议开场提示

用户可以在新 Codex 对话里直接说：

```text
请先阅读 C:\Users\y1513\Desktop\cc\cc-yh\codex.md，然后接着修 cc-yh 项目。重点先真实测试桌面启动动画、使用统计曲线和 provider 兼容。不要用 cc-haha。
```

AI 接手后应立即：

1. `cd C:\Users\y1513\Desktop\cc\cc-yh`
2. 阅读 `codex.md`
3. 查看 `git status --short`
4. 针对用户新问题定位相关文件
5. 修改后跑对应检查
6. 需要真实 UI 的，用 `bun run tauri dev` 让用户观察，或自己从日志判断