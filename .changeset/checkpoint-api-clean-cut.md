---
'@noocodex/dagonizer': minor
---

**BREAKING:** The `Checkpoint` API consolidates around `Checkpoint.capture()`,
`Checkpoint.load()`, `Checkpoint.recall()`, and instance methods. The legacy
static helpers are removed.

Migration table:

| Old | New |
|---|---|
| `const data = Checkpoint.from('dag', result); save(Checkpoint.toJson(data));` | `const ckpt = await Checkpoint.capture('dag', result); save(ckpt.toJson());` |
| `Checkpoint.restore(raw, fn)` | `Checkpoint.load(raw).restoreState(fn)` |
| `await Checkpoint.persist(store, key, data)` | `await ckpt.persist(store, key)` |
| `await Checkpoint.recall(store, key, fn)` | `const ckpt = await Checkpoint.recall(store, key); ckpt?.restoreState(fn)` |

Removed methods:

- `Checkpoint.from(dagName, result)` — replaced by `Checkpoint.capture` (returns a `Checkpoint` instance with `.data`).
- `Checkpoint.restore(data, fn)` — replaced by `Checkpoint.load(raw).restoreState(fn)`.
- `Checkpoint.toJson(data)` (static) — replaced by instance `ckpt.toJson()`.
- `Checkpoint.persist(store, key, data)` (static, three-arg) — replaced by instance `ckpt.persist(store, key)`.
- `Checkpoint.recall(store, key, fn)` (three-arg with restore factory) — replaced by `Checkpoint.recall(store, key)` returning `Promise<Checkpoint | null>`.

(Bump remains minor since the project is pre-1.0; semver allows breaking changes in 0.x minors.)
