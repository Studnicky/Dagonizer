# @studnicky/dagonizer-store-file

Node.js file-backed graph dataset provider for Dagonizer.

```ts
import { FileGraphDatasetProvider } from '@studnicky/dagonizer-store-file';
import { Dagonizer } from '@studnicky/dagonizer';

const dispatcher = new Dagonizer({
  graphStore: new FileGraphDatasetProvider('./runs'),
});
```

The provider keeps one durable graph per run and reopens it with
`await graphStore.reopen(runIri)`. Child graphs are isolated and volatile by
default. Pass `{ durableChildren: true }` when child placement graphs must also
survive a restart.

The package is Node-only. Browser-compatible applications use the in-memory or
N3 provider exported by `@studnicky/dagonizer`.
