# @studnicky/dagonizer-adapter-anthropic

## [Unreleased]

### Added

- Send `anthropic-dangerous-direct-browser-access: true` on model-list and message requests so the adapter works from a browser (direct-to-Anthropic CORS).

## 0.26.0

## 0.25.0

## 0.24.0

### Minor Changes

- Initial release. Adds `AnthropicApiAdapter` — a first-class adapter for the Anthropic Messages API that extends `BaseAdapter` directly (not `OpenAiCompatibleAdapter`) to support Anthropic's distinct wire format: top-level `system` prompt extraction, `tool_result` content blocks for tool responses, `input_schema` in tool definitions, and typed `content[]` response blocks with `stop_reason` decoding.
