# FAQ

## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**Cause**: Your upstream endpoint is not returning the protocol shape that this project expects.

There are now two supported direct paths:

- Anthropic-compatible Messages APIs
- OpenAI-compatible APIs with `CLAUDE_CODE_COMPAT_PROVIDER=openai`

If you are using an Anthropic-compatible provider, `ANTHROPIC_BASE_URL` must point to the provider's Anthropic API root. The Anthropic SDK appends `/v1/messages` automatically.

Examples:

- MiniMax: `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`
- OpenRouter: `ANTHROPIC_BASE_URL=https://openrouter.ai/api`

If you are using an OpenAI-compatible provider directly, configure:

```text
CLAUDE_CODE_COMPAT_PROVIDER=openai
CLAUDE_CODE_OPENAI_COMPAT_MODE=chat_completions
ANTHROPIC_BASE_URL=https://api.openai.com/v1
ANTHROPIC_AUTH_TOKEN=sk-xxx
```

Or use the desktop provider settings with `OpenAI Chat` or `OpenAI Responses`.

If the upstream still does not behave compatibly enough, use a proxy such as LiteLLM. See the [Third-Party Models Guide](./third-party-models.md).

## Q: `Cannot find package 'bundle'`

```text
error: Cannot find package 'bundle' from '.../claude-yh/src/entrypoints/cli.tsx'
```

**Cause**: Your Bun version is too old and does not support the required `bun:bundle` built-in module.

**Fix**:

```bash
bun upgrade
```

## Q: How do I use OpenAI / DeepSeek / Ollama or other non-Anthropic models?

You have two main options now:

- Direct OpenAI-compatible access via `OpenAI Chat` or `OpenAI Responses`
- A proxy layer such as LiteLLM when the upstream is not compatible enough or when you want routing/fallback features

See the [Third-Party Models Guide](./third-party-models.md).

## Q: Does "OpenAI-compatible" mean any OpenAI-looking document will work?

No.

In practice, it usually works when the upstream really implements:

- `Authorization: Bearer <apiKey>`
- `/v1/chat/completions` or `/v1/responses`
- Usable streaming and tool-calling behavior

Website login cookies, browser session tokens, and ChatGPT web auth do not count as supported API credentials here.


