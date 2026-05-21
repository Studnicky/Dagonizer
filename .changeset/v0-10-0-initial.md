---
"@noocodex/dagonizer": minor
"@noocodex/dagonizer-adapter-cerebras": minor
"@noocodex/dagonizer-adapter-gemini-api": minor
"@noocodex/dagonizer-adapter-gemini-nano": minor
"@noocodex/dagonizer-adapter-groq": minor
"@noocodex/dagonizer-adapter-mistral": minor
"@noocodex/dagonizer-adapter-openrouter": minor
"@noocodex/dagonizer-adapter-stub": minor
"@noocodex/dagonizer-adapter-web-llm": minor
"@noocodex/dagonizer-book-entities": minor
"@noocodex/dagonizer-tool-googlebooks": minor
"@noocodex/dagonizer-tool-openlibrary": minor
"@noocodex/dagonizer-tool-wikipedia": minor
"@noocodex/dagonizer-patterns-flow": minor
"@noocodex/dagonizer-patterns-graph": minor
"@noocodex/dagonizer-patterns-rag": minor
---

v0.10.0 — Plugin architecture per RFC 0001.

Main package gains three subpaths: `./adapter`, `./patterns`, `./tool`.
Eight cloud / on-device adapter packages, three external-service tool
packages, and three pattern packages ship for the first time. The
Archivist example consumes them all and demonstrates the canonical
extension pattern.

Required-with-defaults + V8 shape stability principles enforced
across every contract surface.
