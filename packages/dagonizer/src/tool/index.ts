/**
 * @studnicky/dagonizer/tool: public tool contract surface.
 *
 * Ships:
 *   - `Tool<TInput, TOutput>`: canonical executable-tool interface
 *     (couples a JSON-Schema `ToolDefinition` with `execute()`).
 *   - `ToolError` + `ToolErrorReason`: narrow error taxonomy for
 *     tool-execution failures.
 *   - `HttpTransport`: static class providing the shared fetch
 *     wrapper every HTTP-backed tool needs (timeout, retry, abort
 *     propagation, JSON parsing).
 */

export type { Tool } from './Tool.js';

export {
  ToolError,
} from './ToolError.js';
export type {
  ToolErrorOptions,
  ToolErrorReason,
} from './ToolError.js';

export {
  HttpTransport,
} from './HttpTransport.js';
export type {
  HttpRequestOptions,
} from './HttpTransport.js';
