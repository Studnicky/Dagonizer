---
"@studnicky/dagonizer": patch
---

Docs toolchain devDependency bumps:

- `vue-tsc` bumped from `^2.2.12` to `^3.3.5`. vue-tsc 3 introduces the Volar 2
  rewrite; its TypeScript peer requirement (`>=5.0.0`) is satisfied by the
  workspace's pinned TS 6.0.3. `typecheck:docs` and `docs:build` pass clean.

- `vite` bumped from `6.4.3` to `^8.1.0` in `examples/the-archivist/package.json`.
  The-archivist is a standalone browser demo; its `vite build` passes clean under
  vite 8 with no source changes. Version spec updated from exact pin to caret
  convention matching the rest of the workspace.
