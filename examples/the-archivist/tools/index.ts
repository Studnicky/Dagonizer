/**
 * Tools barrel — every Archivist collection tool is now a plugin package.
 * Kept as a re-export so existing example imports continue to work.
 */

export type { Tool } from '@noocodex/dagonizer/tool';
export type { ToolCall, ToolDefinition } from '@noocodex/dagonizer/adapter';

export {
  CanonicalId,
  OpenLibrarySearchTool,
  SubjectSearchTool,
} from '@noocodex/dagonizer-tool-openlibrary';
export { GoogleBooksTool }      from '@noocodex/dagonizer-tool-googlebooks';
export { WikipediaSummaryTool } from '@noocodex/dagonizer-tool-wikipedia';
