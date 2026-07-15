# @studnicky/dagonizer-store-file

Node.js file-backed graph dataset provider for Dagonizer.

```ts
import { FileGraphDatasetProvider } from '@studnicky/dagonizer-store-file';
import { Dagonizer } from '@studnicky/dagonizer';

const dispatcher = new Dagonizer({
  graphStore: new FileGraphDatasetProvider('./runs'),
});
```

The package is Node-only. Browser-compatible applications use the in-memory or
N3 provider exported by `@studnicky/dagonizer`.
