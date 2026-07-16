---
"@studnicky/dagonizer": major
---

`StateAccessorInterface` gains a required `append(state, path, value)` — the
canonical, O(1) way to accumulate into a state array. The built-in gather
strategies (`map`, `append`, `partition`, `collect`) use it instead of
read-modify-write (`set(path, [...get(path), value])`), which copied the whole
array on every item and was quadratic across a batch. `DottedPathAccessor`
implements it as an in-place push; the removed `GatherStrategy.asList` helper
supported the old copy-append pattern. Custom `StateAccessorInterface`
implementations must add `append`.
