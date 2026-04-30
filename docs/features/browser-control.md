# BrowserControl

BrowserControl 是 claude-yh 的底层浏览器能力。它连接用户当前 Chrome 会话，而不是另开一个干净浏览器，因此可以在用户已有登录态、已有标签页和真实页面环境中工作。

## 能做什么

- 列出和切换当前 Chrome 标签页
- 打开页面、读取 DOM、提取文本和元素
- 点击、输入、提交表单
- 截图
- 读取控制台和网络日志
- 结合模型完成网页任务，例如搜索、表单填写、页面检查

## 不能做什么

- 绕过验证码、2FA、登录风控
- 静默读取密码、敏感 cookie 或隐私数据
- 替用户确认支付、转账、删除大量数据等高风险操作
- 绕过网站授权或访问控制

权限边界最终由工具层校验，不只依赖模型自觉。

## 后端

当前 BrowserControl 支持多后端：

| 后端 | 用途 |
| ---- | ---- |
| `tmwd-cdp-bridge` | 连接已安装的 Chrome 扩展，使用当前 Chrome 会话和登录态 |
| `claude-in-chrome` / MCP | 兼容现有 MCP 浏览器能力 |
| Chrome DevTools / Playwright fallback | 调试或后备路径 |

默认优先使用 `tmwd-cdp-bridge`。本地 bridge 监听：

```text
ws://127.0.0.1:18765
```

## 使用方式

### CLI

```text
/browser
```

`/browser` 用于查看和调整浏览器能力状态、默认后端、高权限能力和确认策略。

### Web / 桌面端

进入设置页的 Browser 选项，可以查看：

- 是否启用 BrowserControl
- 当前后端
- TMWD 连接状态
- 扩展目录
- 最近恢复的 tab 快照
- 敏感确认和高权限开关

## 故障排查

### TMWD 未连接

确认 Chrome 扩展已安装并启用，然后检查本地服务是否监听：

```powershell
netstat -ano | findstr 18765
```

如果端口被旧进程占用，结束旧进程后重启桌面端或 server。

### 能读页面但操作不准

优先检查：

- DOM 读取是否拿到了正确 tab
- 页面是否有 iframe、遮罩层或动态渲染
- 是否需要先聚焦输入框
- 是否被验证码、登录或站点风控拦截

BrowserControl 的正确工作流是：先读取页面结构，再定位元素，再执行点击/输入，最后读取结果验证。

## 日志

关键调用会写入诊断日志和 BrowserControl audit 信息，便于定位是哪一次调用失败：

```text
~/.claude-yh/logs/diagnostics/*.jsonl
```

