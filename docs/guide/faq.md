# 常见问题

## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**原因**：你当前配置的上游返回的并不是这个项目期望的协议格式。

现在项目支持两种直连方式：

- Anthropic 兼容 Messages API
- OpenAI 兼容 API，配合 `CLAUDE_CODE_COMPAT_PROVIDER=openai`

如果你接的是 Anthropic 兼容服务，`ANTHROPIC_BASE_URL` 必须指向该服务的 Anthropic API 根路径。Anthropic SDK 会自动在后面补 `/v1/messages`。

示例：

- MiniMax: `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`
- OpenRouter: `ANTHROPIC_BASE_URL=https://openrouter.ai/api`

如果你接的是 OpenAI 兼容服务，直接配置：

```text
CLAUDE_CODE_COMPAT_PROVIDER=openai
CLAUDE_CODE_OPENAI_COMPAT_MODE=chat_completions
ANTHROPIC_BASE_URL=https://api.openai.com/v1
ANTHROPIC_AUTH_TOKEN=sk-xxx
```

或者在桌面端 Provider 里选择 `OpenAI Chat` / `OpenAI Responses`。

如果上游本身兼容性还是不够，再考虑用 LiteLLM 之类代理。详见 [第三方模型指南](./third-party-models.md)。

## Q: `Cannot find package 'bundle'`

```text
error: Cannot find package 'bundle' from '.../claude-yh/src/entrypoints/cli.tsx'
```

**原因**：你的 Bun 版本太旧，不支持项目依赖的 `bun:bundle` 内置模块。

**解决**：

```bash
bun upgrade
```

## Q: 怎么接 OpenAI / DeepSeek / Ollama 这类非 Anthropic 模型？

现在主要有两种方式：

- 直接接 OpenAI 兼容接口，使用 `OpenAI Chat` 或 `OpenAI Responses`
- 如果上游兼容性不够，或者你需要路由 / 回退 / 统一治理，再用 LiteLLM 一类代理

详见 [第三方模型指南](./third-party-models.md)。

## Q: 只要是 OpenAI 风格文档都一定能用吗？

不一定。

通常至少要满足这些条件，才能算这里说的“可直接接入”：

- 支持 `Authorization: Bearer <apiKey>`
- 支持 `/v1/chat/completions` 或 `/v1/responses`
- 流式输出和工具调用不要太偏离标准

网页登录 cookie、浏览器 session token、ChatGPT 网页登录态这类都不属于这里支持的 API 凭证。


