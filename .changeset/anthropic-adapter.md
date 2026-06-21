---
"@studnicky/dagonizer": minor
---

Adds `@studnicky/dagonizer-adapter-anthropic` — a first-class adapter for the Anthropic Messages API. `AnthropicApiAdapter` extends `BaseAdapter` directly (not `OpenAiCompatibleAdapter`) because Anthropic's wire format is distinct from OpenAI's: system prompts are a top-level `system` field, tool responses are `tool_result` content blocks inside user turns, tool definitions use `input_schema` instead of `parameters`, and the response payload is a typed `content[]` array with a `stop_reason` field. Full `tool_use` capability is supported including all tool-choice variants (`auto`, `required`/`any`, `none`, specific tool). The adapter ships with intercepted-fetch wire-format tests covering text responses, `tool_use` responses, and mixed responses.
