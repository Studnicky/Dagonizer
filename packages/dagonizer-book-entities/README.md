# @studnicky/dagonizer-book-entities

Shared book-domain entity types + canonical-id derivation for the `@studnicky/dagonizer-tool-*` book search plugins. Pulled out of OpenLibrary in v0.10.0 so the three book-search tools (`-openlibrary`, `-googlebooks`, `-wikipedia`) share one Candidate shape and one dedupe utility.

## Install

```bash
npm install @studnicky/dagonizer-book-entities
```

You usually don't depend on this package directly; the book-search tool packages re-export the types and `CanonicalId` for ergonomic single-package imports.

## Exports

| Symbol | Shape | Purpose |
|---|---|---|
| `Book` | interface | ISBN, title, authors, price (Money), summary, year, subjects, publishers |
| `Candidate` | interface | `Book` + ranking signal (score, source, reason, freeform notes) |
| `Money` | interface | `{ amount, currency }` typed currency union |
| `CanonicalId` | static class | Stable id derivation + dedupe across heterogeneous sources |

## CanonicalId

```ts
import { CanonicalId } from '@studnicky/dagonizer-book-entities';

CanonicalId.fromIsbns(['1234567890', '9781234567897']);
// → '9781234567897' (ISBN-13 wins)

CanonicalId.fromWork('Neuromancer', 'William Gibson');
// → 'urn:work:neuromancer::william-gibson'

CanonicalId.pick({ isbns: [], title: 'Solaris', authors: ['Stanisław Lem'] });
// → 'urn:work:solaris::stanis-aw-lem'

CanonicalId.dedupe(candidatesFromMultipleSources);
// → unique Candidate[] with sources accumulated, descriptions merged
```

Priority order for canonical id derivation:

1. ISBN-13 (preferred, universally unique)
2. ISBN-10 (older catalogue records)
3. `urn:isbn:<x>` (when only one form is reachable)
4. `urn:work:<slug>` (`title|first-author` normalised; covers cross-source matches when ISBNs are absent)

`CanonicalId.dedupe(...)` merges colliding candidates: keeps the richest summary, longest author list, union of subjects/publishers, accumulates `sources[]` so downstream prose can cite all original lookups.

## Stability

This package is part of the v0.10.0 plugin ecosystem and follows the same independent-versioning policy as the book-search tool plugins. Breaking changes to `Book` / `Candidate` shape require a major bump.

## License

MIT
