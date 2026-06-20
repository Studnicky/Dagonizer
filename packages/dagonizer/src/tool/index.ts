/**
 * @studnicky/dagonizer/tool: public tool contract surface.
 *
 * Ships:
 *   - `ToolInterface<TInput, TOutput>`: canonical executable-tool interface
 *     (couples a JSON-Schema `ToolDefinition` with `execute()`).
 *   - `ToolError` + `ToolErrorReasonType`: narrow error taxonomy for
 *     tool-execution failures.
 *   - `HttpTransport`: static class providing the shared fetch
 *     wrapper every HTTP-backed tool needs (timeout, retry, abort
 *     propagation, JSON parsing).
 *   - `OpenApiGuard`: static class narrowing a fetched JSON body to a
 *     schema-derived type via a compiled `EntityValidatorInterface`, throwing
 *     `ToolError(PARSE_ERROR)` on a shape mismatch.
 */

export type { ToolInterface } from './ToolInterface.js';

export {
  OpenApiGuard,
} from './OpenApiGuard.js';

export {
  ToolError,
} from './ToolError.js';
export type {
  ToolErrorOptionsType,
  ToolErrorReasonType,
} from './ToolError.js';

export {
  HttpTransport,
} from './HttpTransport.js';
export type {
  HttpRequestOptionsType,
} from './HttpTransport.js';

export {
  ToolInvocationState,
} from './ToolInvocationState.js';

export {
  ToolInvokeNode,
} from './ToolInvokeNode.js';

export {
  ToolRegistry,
} from './ToolRegistry.js';
export type {
  ResolvedToolType,
} from './ToolRegistry.js';
