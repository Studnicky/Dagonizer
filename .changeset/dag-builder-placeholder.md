---
"@studnicky/dagonizer": minor
---
DAGBuilder.placeholder(name, outputs, routes) adds a PlaceholderNode stub in one call.
PlaceholderNode routes unconditionally to its first output; replace with a concrete
ScalarNode subclass when ready.
