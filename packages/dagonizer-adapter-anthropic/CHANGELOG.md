# @studnicky/dagonizer-adapter-anthropic

## [unreleased]

### Patch Changes

- Add a consumer-configurable `systemPrompt` option, forwarded to the `BaseAdapter` seam: when set, it is injected as the leading system turn of any request that carries no system message of its own (never overriding an explicit one, no-op when empty). Lets a consumer frame persona/format once at construction instead of hand-prepending a system message to every call.
- Forward `request.maxTokens` to Anthropic's required top-level `max_tokens` field (default 1024 when the request leaves it unset).
- Enforce the `timeoutMs` deadline (default 60s) around the `/v1/messages` POST via an internal `AbortController`. An expired deadline surfaces as a `TIMEOUT` classification — the timeout abort reason is a `TIMEOUT`-classified `LlmError` that the network catch now re-throws unchanged, so it is no longer downgraded to `NETWORK`. A cascade falls through to the next adapter instead of hanging.

## 0.27.0

### Added

- Send `anthropic-dangerous-direct-browser-access: true` on model-list and message requests so the adapter works from a browser (direct-to-Anthropic CORS).

## 0.26.0

## 0.25.0

## 0.24.0

### Minor Changes

- Initial release. Adds `AnthropicApiAdapter` — a first-class adapter for the Anthropic Messages API that extends `BaseAdapter` directly (not `OpenAiCompatibleAdapter`) to support Anthropic's distinct wire format: top-level `system` prompt extraction, `tool_result` content blocks for tool responses, `input_schema` in tool definitions, and typed `content[]` response blocks with `stop_reason` decoding.
