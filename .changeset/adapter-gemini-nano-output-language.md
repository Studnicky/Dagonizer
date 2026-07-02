---
'@studnicky/dagonizer-adapter-gemini-nano': minor
---

`GeminiNanoAdapter` resolves and attests a Prompt API `outputLanguage` on every `LanguageModel.create()` call, eliminating Chrome's per-request console warning ("No output language was specified"). Resolution precedence: an explicit `GeminiNanoAdapterOptionsType.outputLanguage`, then the browser's `navigator.language` narrowed to Chrome's supported code set (`de`, `en`, `es`, `fr`, `ja`), then `en`.
