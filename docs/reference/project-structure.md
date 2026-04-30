# 项目结构


```
bin/claude-yh.js         # npm/bin 入口
bin/claude-yh            # Unix 包装脚本
preload.ts               # Bun preload
src/
├── entrypoints/cli.tsx  # CLI 主入口
├── main.tsx             # TUI 主逻辑（Commander.js + React/Ink）
├── localRecoveryCli.ts  # 降级 Recovery CLI
├── setup.ts             # 启动初始化
├── screens/REPL.tsx     # 交互 REPL 界面
├── ink/                 # Ink 终端渲染引擎
├── components/          # UI 组件
├── tools/               # Agent 工具（Bash, Edit, Grep 等）
├── commands/            # 斜杠命令（/commit, /review 等）
├── browserControl/      # BrowserControl 能力层
├── jarvis/              # Jarvis 常驻智能体、队列、Manager CLI 编排
├── runtime/             # TypeScript ↔ Rust sidecar 协议和 fallback
├── server/              # Web/Desktop API 和 WebSocket 服务
├── skills/              # Skill 系统
├── services/            # 服务层（API, MCP, OAuth 等）
├── hooks/               # React hooks
└── utils/               # 工具函数
desktop/
├── src/                 # React 桌面/Web UI
├── sidecars/            # server/adapters sidecar 入口
├── scripts/             # 构建 native sidecar 的脚本
└── src-tauri/           # Tauri 2 桌面壳
adapters/                # Telegram、飞书、钉钉等 IM adapter
runtime/                 # Computer Use Python helper，被 server 按文本 import
rust/                    # claude-yh-runtime-sidecar Rust workspace
docs/                    # VitePress 文档
tmp/                     # 本地清理/临时文件，已被 .gitignore 忽略
```

## 配置与本地数据

- 默认运行配置：`~/.claude-yh/settings.json`
- Provider、Web 搜索、BrowserControl、Jarvis、记忆等设置都应进入 `~/.claude-yh/`
- 仓库根目录不再保留 `.env` / `.env.example`
- 如果必须临时覆盖环境变量，使用 `claude-yh --env-file C:\path\to\custom.env`


