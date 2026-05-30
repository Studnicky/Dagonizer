# @noocodex/dagonizer-tool-wikipedia

Wikipedia page summary tool for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Returns enrichment context for any topic, person, place, or book the agent needs background on.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-tool-wikipedia
```

## Usage

```ts
import { WikipediaSummaryTool } from '@noocodex/dagonizer-tool-wikipedia';

const results = await WikipediaSummaryTool.execute({ query: 'House of Leaves' });
// Returns a Candidate-shaped record with summary, subjects, year, etc.
```

## Exports

| Symbol | Shape | Purpose |
|---|---|---|
| `WikipediaSummaryTool` | `Tool<{ query }, readonly Candidate[]>` | Page summary fetch |
| `Book`, `Candidate`, `Money` | types | Output entity shapes (Wikipedia results are mapped into the same Candidate shape OpenLibrary / Google Books emit, so the dedupe pass can collapse cross-source mentions) |

## Endpoint

- `GET https://en.wikipedia.org/api/rest_v1/page/summary/<title>`

No API key. CORS-enabled. Per Wikipedia's bot policy, set a meaningful `User-Agent` for production use (this tool currently sends the default `node-fetch` UA, fine for low-volume demos; identify your app for production).

## Why a book tool for Wikipedia

The Archivist uses `WikipediaSummaryTool` to enrich context when the visitor asks about a book set in a real place / time period, or when they ask about an author's biography. The tool emits `Candidate`-shaped output so the same merge + rank flow handles it alongside OpenLibrary / Google Books results.

## License

MIT
