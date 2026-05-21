# Changesets

This workspace publishes 15 packages independently (1 main + 8 adapters
+ 3 tools + 3 patterns). Use changesets to record version bumps:

```
pnpm changeset
```

The interactive prompt asks which packages changed and at what level
(patch / minor / major). Commit the generated changeset file.

When ready to release:

```
pnpm changeset version    # bumps versions + updates CHANGELOGs
pnpm install              # refreshes the lockfile
git commit -am "release"
pnpm -r publish           # publishes everything that changed
```

`@noocodex/the-archivist-example` and the workspace root are ignored —
they're never published.
