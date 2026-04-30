# 使用第三方模型

现在这个项目支持三种接入方式：

1. 直连 Anthropic 兼容 API
2. 直连 OpenAI 兼容 API
3. 可选地通过 LiteLLM 等代理中转

接入 OpenAI 兼容模型已经不再强制依赖 LiteLLM。

## 方式一：直连 OpenAI 兼容 API

如果上游提供的是真正的 OpenAI 兼容 HTTP 接口，通常可以直接接入。

### 需要满足的条件

你的上游最好同时支持下面几项：

- `Authorization: Bearer <apiKey>`
- `/v1/chat/completions` 或 `/v1/responses`
- 你实际会用到的能力，尤其是流式输出和工具调用

推荐使用桌面端配置：

1. 打开 `Settings -> Providers -> Add Provider`
2. `API Format` 选择 `OpenAI Chat` 或 `OpenAI Responses`
3. `Base URL` 填上游的 OpenAI API 根路径，例如 `https://api.openai.com/v1`
4. 填写 `API Key` 和模型 ID

示例：

- Base URL: `https://api.openai.com/v1`
- API Format: `openai_chat`
- Main model: `gpt-4o`

也可以直接用环境变量配置：

```text
CLAUDE_CODE_COMPAT_PROVIDER=openai
CLAUDE_CODE_OPENAI_COMPAT_MODE=chat_completions
ANTHROPIC_BASE_URL=https://api.openai.com/v1
ANTHROPIC_AUTH_TOKEN=sk-xxx
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o-mini
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
```

如果你要走 Responses API，把模式改成：

```text
CLAUDE_CODE_OPENAI_COMPAT_MODE=responses
```

### 重要说明

“OpenAI 兼容”不等于“所有提供商都完全一致”。

大多数实现比较完整的 OpenAI 兼容接口都可以直接用，但常见问题还是集中在这些地方：

- 流式 chunk 格式不标准
- 工具调用只兼容一部分
- 不支持 `/v1/responses`
- reasoning / thinking 字段命名不同
- 对工具名、参数长度、schema 的限制不同

这里支持的是 API 凭证，不支持网页登录态。ChatGPT / OpenAI 官网的 cookie、session token、网页登录 access token 这类都不属于这里说的 API 兼容接入。

## 方式二：直连 Anthropic 兼容 API

有些提供商本身就暴露 Anthropic Messages API，不需要任何协议转换。

### OpenRouter

```text
ANTHROPIC_AUTH_TOKEN=sk-or-v1-xxx
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_MODEL=openai/gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=openai/gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=openai/gpt-4o-mini
ANTHROPIC_DEFAULT_OPUS_MODEL=openai/gpt-4o
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### MiniMax

```text
ANTHROPIC_AUTH_TOKEN=your_minimax_api_key_here
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

## 方式三：LiteLLM 或其他代理

LiteLLM 现在仍然有价值，但已经是可选项，不再是前置条件。

这些场景下仍然建议用代理：

- 你想把多个厂商统一挂在一个入口后面
- 你需要路由、回退、负载均衡、限流或统一治理
- 某个上游号称 OpenAI 兼容，但实际兼容性不够
- 你希望只暴露一个稳定地址给本项目

最小 LiteLLM 配置示例：

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  drop_params: true
```

然后把本项目指向代理：

```text
ANTHROPIC_AUTH_TOKEN=sk-anything
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
```

## 实用建议

### OpenAI Chat 和 OpenAI Responses 该怎么选？

- 如果上游文档主要写的是 `/v1/chat/completions`，优先选 `OpenAI Chat`
- 如果上游明确而且稳定支持 `/v1/responses`，优先选 `OpenAI Responses`

### Base URL 应该填什么？

应该填提供商文档里的 API 根路径。很多 OpenAI 兼容服务会把版本段一起放在这里。

常见示例：

- `https://api.openai.com/v1`
- `https://api.deepseek.com/v1`

不要把完整接口路径 `/v1/chat/completions` 或 `/v1/responses` 直接填进 Base URL。

### 什么时候还需要 LiteLLM？

当上游本身兼容性不够，或者你就是需要代理层的路由和治理能力时，再用 LiteLLM。

## 已知限制

- Anthropic 专有能力，例如 prompt caching，并不能完整映射到 OpenAI 兼容接口
- 工具调用已经尽量补齐，但不同提供商在边角行为上仍可能不一致
- reasoning / thinking 字段会做归一化处理，不保证各家完全同义
- 如果某家“OpenAI 兼容”只是部分兼容，最容易出错的通常还是流式、工具调用和 schema 细节


