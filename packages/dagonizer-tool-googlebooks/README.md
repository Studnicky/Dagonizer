# @studnicky/dagonizer-tool-googlebooks

Google Books v1 volume search tool for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Adds rating signals (`notes.rating`, `notes.ratingsCount`) to the canonical `Candidate` shape so review-weighted ranking has real data to work with.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-tool-googlebooks
```

## Usage

```ts
import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';

const candidates = await GoogleBooksTool.execute({ query: 'Murakami', limit: 10 });
console.log(candidates[0].notes?.rating);     // 4.5
console.log(candidates[0].notes?.ratingsCount); // 1873
```

## Exports

| Symbol | Shape | Purpose |
|---|---|---|
| `GoogleBooksTool` | `Tool<{ query, limit? }, readonly Candidate[]>` | Volume search |
| `Book`, `Candidate`, `Money` | types | Output entity shapes |

## Endpoint

- `GET https://www.googleapis.com/books/v1/volumes?q=<query>&maxResults=<n>`

No API key required for read-only volume search (Google's free tier covers anonymous queries). Subject to Google's anonymous rate limit (~1000/day).

## Composition with OpenLibrary

`GoogleBooksTool` outputs are mergeable with `@studnicky/dagonizer-tool-openlibrary` via `CanonicalId.dedupe`: both tools emit `Candidate` shapes with stable canonical ids, so cross-source duplicates collapse to a single richer record.

## License

MIT
