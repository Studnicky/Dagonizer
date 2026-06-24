---
"@studnicky/dagonizer": patch
---
Harden `DottedPathAccessor.set` against prototype pollution by guarding each
property write inline. The `__proto__`/`prototype`/`constructor` segment check
now sits directly on the path to every assignment, so a config-supplied dotted
path can never walk or mutate the prototype chain. Behaviour is unchanged for
all legitimate paths; forbidden or empty segments make the write a no-op.
