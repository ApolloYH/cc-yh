# 安装与构建

## 当前发布目标

桌面端当前以 **Windows x64** 为主要发布目标：

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `Claude.YH_x.x.x_x64-setup.exe` |

CLI 可以在支持 Bun/Node 的平台运行；桌面安装包目前不发布 macOS 版本。

## Windows 安装

1. 前往 [GitHub Releases](https://github.com/ApolloYH/cc-yh/releases) 下载 Windows x64 安装包。
2. 双击 `.exe` 安装程序，按向导完成安装。
3. 首次运行如果 SmartScreen 弹出警告，点击“更多信息”再点击“仍要运行”。

> 应用暂未进行 Windows 代码签名，首次运行可能需要手动确认。

## Web UI 模式

如果不安装桌面端，也可以通过浏览器使用 Web 开发界面：

```bash
# 1. 项目根目录启动服务端
SERVER_PORT=3456 bun run src/server/index.ts

# 2. desktop 目录启动前端
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

启动后访问：

```text
http://127.0.0.1:2024
```

## 桌面端开发启动

```powershell
cd desktop
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
bun run tauri dev
```

## 常见问题

**Q: Windows 提示缺少 WebView2？**

从 [Microsoft 官方页面](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 安装 WebView2 Runtime。

**Q: Rust sidecar 被杀毒软件删除怎么办？**

`claude-yh-runtime-sidecar.exe` 是本项目的 Rust 加速内核，用于安全策略、文件边界、搜索索引和 Jarvis 队列恢复。部分杀毒软件可能误报未签名 Rust 可执行文件。处理方式：

1. 确认文件路径来自本仓库构建目录或官方 release。
2. 将项目构建目录加入信任区。
3. 重新运行 `cargo build --manifest-path rust/Cargo.toml` 或重新构建桌面端。
