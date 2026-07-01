---
"@studnicky/dagonizer": patch
---

`BaseAdapter.selectChatModel()` now prefers a fully-local model when auto-selecting the cheapest chat model. A cloud-routed model (e.g. Ollama's `:cloud`/`-cloud` tags) reports a near-zero local footprint, so it ranks cheapest by `costRank` and was being auto-selected — but it needs a provider subscription and fails without one. The cheapest-fallback now picks from the non-`cloud` models when any exist, only falling back to a cloud model when no local chat model is installed. An explicit in-catalogue `preferred` model still wins regardless of its `cloud` flag.
