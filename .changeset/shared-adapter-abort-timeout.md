---
"@studnicky/dagonizer": patch
"@studnicky/dagonizer-adapter-gemini-api": patch
"@studnicky/dagonizer-adapter-anthropic": patch
"@studnicky/dagonizer-adapter-gemini-nano": patch
"@studnicky/dagonizer-adapter-web-llm": patch
---

Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.
