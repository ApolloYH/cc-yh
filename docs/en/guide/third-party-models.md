# Using Third-Party Models

This project now supports three integration paths:

1. Direct Anthropic-compatible APIs
2. Direct OpenAI-compatible APIs
3. Optional proxy layers such as LiteLLM

LiteLLM is no longer required just to use OpenAI-compatible providers.

## Option 1: Direct OpenAI-Compatible APIs

If your upstream exposes a real OpenAI-compatible HTTP API, you can usually connect it directly.

### Requirements

Your upstream should support all of the following:

- `Authorization: Bearer <apiKey>`
- `/v1/chat/completions` or `/v1/responses`
- The model/features you actually need, especially streaming and tool calling

Recommended desktop setup:

1. Open `Settings -> Providers -> Add Provider`
2. Set `API Format` to `OpenAI Chat` or `OpenAI Responses`
3. Set `Base URL` to the provider's OpenAI API root, for example `https://api.openai.com/v1`
4. Fill in `API Key` and your model IDs

Example values:

- Base URL: `https://api.openai.com/v1`
- API Format: `openai_chat`
- Main model: `gpt-4o`

You can also configure the runtime directly through env vars:

```env
CLAUDE_CODE_COMPAT_PROVIDER=openai
CLAUDE_CODE_OPENAI_COMPAT_MODE=chat_completions
ANTHROPIC_BASE_URL=https://api.openai.com/v1
ANTHROPIC_AUTH_TOKEN=sk-xxx
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o-mini
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
```

For the Responses API, switch:

```env
CLAUDE_CODE_OPENAI_COMPAT_MODE=responses
```

### Important Compatibility Note

"OpenAI-compatible" does not mean "all providers behave identically."

Most providers that implement the OpenAI HTTP API well will work. The most common incompatibilities are:

- Incomplete or nonstandard streaming chunks
- Partial tool-calling support
- Missing `/v1/responses`
- Different reasoning/thinking fields
- Different limits on tool names or arguments

Browser login sessions, website cookies, ChatGPT session tokens, and other web auth artifacts are not supported here. This project expects API credentials, not a browser session.

## Option 2: Direct Anthropic-Compatible APIs

Some providers already expose an Anthropic-compatible Messages API, so no translation layer is needed.

### OpenRouter

```env
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

```env
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

## Option 3: LiteLLM or Other Proxies

LiteLLM is still useful, but now it is optional.

Use a proxy if you need one of these:

- Centralized routing for multiple vendors
- Provider fallback, load balancing, or policy control
- A nonstandard upstream that claims OpenAI compatibility but does not work cleanly
- A single stable endpoint for many backends

Minimal LiteLLM example:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  drop_params: true
```

Then point this project to the proxy:

```env
ANTHROPIC_AUTH_TOKEN=sk-anything
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
```

## Practical Guidance

### Which OpenAI mode should I choose?

- `OpenAI Chat` is the safer default if the provider only documents `/v1/chat/completions`
- `OpenAI Responses` is preferred if the provider supports `/v1/responses` well

### What should the base URL look like?

Use the provider's API root, usually including the version segment if that is how the provider documents it.

Examples:

- `https://api.openai.com/v1`
- `https://api.deepseek.com/v1`

Do not paste the full endpoint path like `/v1/chat/completions` into the base URL field.

### When do I still need LiteLLM?

Only when the upstream is not compatible enough by itself, or when you want proxy features such as routing, fallback, or unified governance.

## Known Limitations

- Anthropic-only features such as prompt caching do not map perfectly to OpenAI-compatible APIs
- Tool calling is much better than before, but some providers still diverge on edge cases
- Reasoning/thinking fields are normalized, not guaranteed to be identical across vendors
- If a provider's "OpenAI-compatible" API is only partial, failures usually happen around streaming, tools, or schema details
