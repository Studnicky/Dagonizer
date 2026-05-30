/**
 * Shared OpenLibrary API types and helpers used by both
 * OpenLibrarySearchTool and SubjectSearchTool.
 */

export interface OpenLibraryDoc {
  readonly title?: string;
  readonly subtitle?: string;
  readonly author_name?: readonly string[];
  readonly isbn?: readonly string[];
  readonly first_publish_year?: number;
  readonly publisher?: readonly string[];
  readonly subject?: readonly string[];
  /** Stable OpenLibrary identifier — `/works/OL...W`. Always present. */
  readonly key?: string;
  readonly first_sentence?: readonly string[];
  /** Some search responses include a description; many don't. */
  readonly description?: string | { value?: string };
  /** ISO 639-2 (alpha-3) language codes the work is published in. */
  readonly language?: readonly string[];
}

export interface OpenLibraryResponse {
  readonly docs?: readonly OpenLibraryDoc[];
  readonly numFound?: number;
}

export function pickDescription(doc: OpenLibraryDoc): string | undefined {
  if (typeof doc.description === 'string' && doc.description.length > 0) return doc.description;
  if (typeof doc.description === 'object' && typeof doc.description.value === 'string') return doc.description.value;
  const first = doc.first_sentence?.[0];
  if (typeof first === 'string' && first.length > 0) {
    return doc.subtitle !== undefined && doc.subtitle.length > 0
      ? `${doc.subtitle} — ${first}`
      : first;
  }
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) return doc.subtitle;
  return undefined;
}
