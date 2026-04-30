# Claude YH Desktop

基于 Tauri 2 + React 的桌面客户端。

## Web 开发模式

Web 模式会在浏览器里打开桌面前端，适合调 UI。需要先启动根目录后端。

第一个终端：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh
bun --env-file=.env run src/server/index.ts
```

第二个终端：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
bun install
bun run dev --host 127.0.0.1 --port 2024
```

浏览器打开：

```text
http://127.0.0.1:2024
```

## 桌面壳 / Tauri 模式

桌面壳会打开真正的 `Claude YH` 应用窗口，适合测试目录选择、系统弹窗、sidecar 和桌面图标。

先确保本机有 Rust / Cargo：

```powershell
winget install Rustlang.Rustup
```

如果下载依赖较慢，可以设置代理：

```powershell
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:ALL_PROXY   = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1"
```

启动桌面壳：

```powershell
cd C:\Users\y1513\Desktop\cc\cc-yh\desktop
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
bun run tauri dev
```

`tauri dev` 会先执行 `bun run build:sidecars && bun run dev`，再打开桌面窗口。开发模式前端地址通常是：

```text
http://localhost:1420
```

## 构建

```bash
# macOS (Apple Silicon)
./scripts/build-macos-arm64.sh

# Windows (x64)
.\scripts\build-windows-x64.ps1
```

构建产物位于 `build-artifacts/` 目录。

## 常见问题

### 3456 端口被占用

```powershell
Get-NetTCPConnection -LocalPort 3456 -State Listen | Select-Object LocalAddress,LocalPort,State,OwningProcess
Stop-Process -Id <PID> -Force
```

### macOS 提示“已损坏，无法打开”

```bash
xattr -cr /Applications/Claude\ YH.app
```
