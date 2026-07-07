# @studnicky/dagonizer-adapter-anthropic

## 1.0.0

### Patch Changes

- Updated dependencies [fdaa32a]
  - @studnicky/dagonizer@1.0.0

## 0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
  - @studnicky/dagonizer@1.0.0

## 0.30.0

### Minor Changes

- 4234bc4: `AnthropicApiAdapter` overrides `performChatStream` with real token streaming: POSTs `/v1/messages` with `stream: true` and drains the SSE body through the shared `SseLineParser`, dispatching Anthropic's named events into `ChatStreamChunkType` pushes on the caller's sink as they arrive. A request carrying tools still falls back to the buffered default.

## 0.29.1

## 0.29.0

### Patch Changes

- 23ec54b: Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

  The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.

## 0.28.1

## 0.28.0

## [unreleased]

### Minor Changes

- `AnthropicApiAdapter` overrides `performChatStream` with real token streaming: it POSTs `/v1/messages` with `stream: true` and drains the SSE body through the shared `SseLineParser`, dispatching Anthropic's named events into `ChatStreamChunkType` pushes on the caller's sink as they arrive. A request carrying tools still falls back to the buffered default (`super.performChatStream`) — partial tool-call JSON is unsafe to parse incrementally.

### Patch Changes

- Add a consumer-configurable `systemPrompt` option, forwarded to the `BaseAdapter` seam: when set, it is injected as the leading system turn of any request that carries no system message of its own (never overriding an explicit one, no-op when empty). Lets a consumer set a default directive once at construction instead of hand-prepending a system message to every call.
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
