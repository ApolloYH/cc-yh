# 环境变量说明


| 变量 | 必填 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 二选一 | API Key，通过 `x-api-key` 头发送 |
| `ANTHROPIC_AUTH_TOKEN` | 二选一 | Auth Token，通过 `Authorization: Bearer` 头发送 |
| `ANTHROPIC_BASE_URL` | 否 | 自定义 API 端点，默认 Anthropic 官方 |
| `ANTHROPIC_MODEL` | 否 | 默认模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 否 | Sonnet 级别模型映射 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 否 | Haiku 级别模型映射 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 否 | Opus 级别模型映射 |
| `API_TIMEOUT_MS` | 否 | API 请求超时，默认 600000 (10min) |
| `DISABLE_TELEMETRY` | 否 | 设为 `1` 禁用遥测 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 否 | 设为 `1` 禁用非必要网络请求 |

## 配置方式

### 方式一：`~/.claude-yh/settings.json`（推荐）

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M2.7-highspeed"
  }
}
```

### 方式二：临时 env 文件（可选）

仓库不再提供 `.env.example`，避免开源仓库携带本地配置模板。需要临时覆盖时，可以自己创建任意 env 文件并通过 `--env-file` 指定：

```text
# API 认证（二选一）
ANTHROPIC_API_KEY=sk-xxx          # 标准 API Key（x-api-key 头）
ANTHROPIC_AUTH_TOKEN=sk-xxx       # Bearer Token（Authorization 头）

# API 端点（可选，默认 Anthropic 官方）
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic

# 模型配置
ANTHROPIC_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7-highspeed

# 超时（毫秒）
API_TIMEOUT_MS=3000000

# 禁用遥测和非必要网络请求
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

```bash
claude-yh --env-file C:\path\to\custom.env
```

> 配置优先级：进程环境变量 / 显式 `--env-file` > `~/.claude-yh/settings.json`


