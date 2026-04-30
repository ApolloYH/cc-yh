# 全局使用（任意目录启动）


如果你希望在任意项目目录直接运行 `claude-yh`，可以通过以下方式配置。配置完成后，`claude-yh` 会自动识别你当前所在的工作目录。

## macOS / Linux

在 `~/.bashrc` 或 `~/.zshrc` 中添加：

```bash
# 方式一：添加 PATH（推荐）
export PATH="$HOME/path/to/claude-yh/bin:$PATH"

# 方式二：alias
alias claude-yh="$HOME/path/to/claude-yh/bin/claude-yh"
```

然后重新加载配置：

```bash
source ~/.bashrc  # 或 source ~/.zshrc
```

## Windows (PowerShell)

在 PowerShell 配置文件中添加：

```powershell
function claude-yh {
  & "C:\path\to\claude-yh\bin\claude-yh.ps1" @args
}
```

## 验证

配置完成后，进入任意项目目录测试：

```powershell
cd C:\path\to\your-other-project
claude-yh
# 启动后询问「当前目录是什么？」，应显示当前项目目录
```

