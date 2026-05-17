/**
 * Tools barrel — every Archivist collection tool + the shared contract.
 *
 * Tools are pure data-acquisition adapters. Every tool returns
 * `readonly Candidate[]` with a normalized `book.isbn` canonical id so
 * `CanonicalId.dedupe` (or the merge node) can collapse cross-source
 * duplicates into one richer candidate carrying multiple `sources[]`.
 */

export type { Tool, ToolCall, ToolDefinition, ToolOutcome } from './ToolDefinition.ts';

export { CanonicalId } from './CanonicalId.ts';
export { OpenLibrarySearchTool } from './OpenLibrarySearchTool.ts';
export { GoogleBooksTool }       from './GoogleBooksTool.ts';
export { SubjectSearchTool }     from './SubjectSearchTool.ts';
export { WikipediaSummaryTool }  from './WikipediaSummaryTool.ts';
