# 快速开始

## 1. 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> 精简版 Linux 如提示 `unzip is required`，先运行 `apt update && apt install -y unzip`

## 2. 安装依赖并配置

```bash
bun install
# 默认读取 ~/.claude-yh/settings.json，详见「环境变量」文档
```

环境变量的完整说明请参考 [环境变量配置](./env-vars.md)。

## 3. 启动

### macOS / Linux

```bash
./bin/claude-yh                          # 交互 TUI 模式
./bin/claude-yh -p "your prompt here"    # 无头模式
./bin/claude-yh --help                   # 查看所有选项
```

### Windows

```powershell
bun run claude-yh                        # 交互 TUI 模式
bun run claude-yh -- -p "your prompt here" # 无头模式
bun run claude-yh -- --help              # 查看所有选项

# 也可以直接调用 Windows 包装脚本
.\bin\claude-yh.ps1
```

## 4. 全局使用（可选）

将 `bin/` 加入 PATH 后可在任意目录启动，详见 [全局使用指南](./global-usage.md)：

```bash
export PATH="$HOME/path/to/claude-yh/bin:$PATH"
```

## 5. 降级模式

如果 Ink TUI 出现问题，可以使用降级 Recovery CLI 模式：

```bash
CLAUDE_CODE_FORCE_RECOVERY_CLI=1 ./bin/claude-yh
```


