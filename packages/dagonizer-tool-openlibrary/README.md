# @noocodex/dagonizer-tool-openlibrary

OpenLibrary search and subject tools for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Hits the free, key-less, CORS-friendly OpenLibrary API.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-tool-openlibrary
```

## Usage

```ts
import { OpenLibrarySearchTool, SubjectSearchTool, CanonicalId } from '@noocodex/dagonizer-tool-openlibrary';

const candidates = await OpenLibrarySearchTool.execute({ query: 'Piranesi', limit: 5 });

// Or via the dispatcher's services bag:
dispatcher.register({ services: { webSearch: OpenLibrarySearchTool } });
```

## Exports

| Symbol | Shape | Purpose |
|---|---|---|
| `OpenLibrarySearchTool` | `Tool<{ query, limit? }, readonly Candidate[]>` | Free-text title/author/ISBN search |
| `SubjectSearchTool` | `Tool<{ subject, limit? }, readonly Candidate[]>` | Subject-index search ("labyrinth", "cyberpunk") |
| `CanonicalId` | static class | Stable id derivation + dedupe across sources |
| `Book`, `Candidate`, `Money` | types | Output entity shapes |

## CanonicalId

`CanonicalId.dedupe(candidates)` collapses duplicates across sources (OpenLibrary, Google Books, Wikipedia) by canonical id derivation:

1. ISBN-13 (preferred, universally unique)
2. ISBN-10 (older catalogue records)
3. `urn:isbn:<x>` (when only one form is reachable)
4. `urn:work:<slug>` (`title|first-author` normalised; covers cross-source title/author matches)

The merge logic keeps the richest description, longest author list, union of subjects/publishers, and accumulates `sources[]` across collapsed candidates.

## Endpoints

- Search: `GET https://openlibrary.org/search.json?q=<query>&limit=<n>`
- Subject: `GET https://openlibrary.org/subjects/<subject>.json?limit=<n>`

No API key required. OpenLibrary serves CORS so the tools run unmodified in Node and browser.

## License

MIT
