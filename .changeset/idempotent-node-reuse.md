---
"@noocodex/dagonizer": patch
---

Node and DAG registration is idempotent by identity — re-registering the same instance (reference equality) is a no-op, enabling node reuse across multiple bundles. Only a different implementation claiming an already-registered name throws `DAGError`, with the message updated to `'X' is already registered with a different implementation` to distinguish the collision from the no-op case.
