import { Validator } from '../validation/Validator.js';

import type { ToolCall } from './LlmAdapter.js';

/**
 * Per-`decode()`-call monotonic sequence counter. Incremented once per call
 * so synthesized ids are stable within a retry chain and unique across calls.
 * Using a module-level counter (not `Date.now()`) keeps ids deterministic for
 * testing and avoids clock-skew across environments.
 */
let decodeSeq = 0;

/**
 * Decode a `{ tool_calls: [{ name, arguments }] }` JSON envelope from a model
 * that emits tool calls as text rather than via a native channel (Gemini Nano,
 * WebLLM). Permissive: extracts the outermost `{ … }` before parsing, so
 * surrounding prose is tolerated. `idPrefix` namespaces the synthesized call
 * ids. Returns `[]` on any parse failure or malformed entry; never throws.
 */
export class ToolCallCodec {
  private constructor() { /* static class */ }

  static decode(raw: string, idPrefix: string): ToolCall[] {
    const seq = decodeSeq++;
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < 0) return [];
      const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
      if (!Validator.textChannelToolCallEnvelope.is(parsed)) return [];
      return (parsed.tool_calls ?? [])
        .filter((c): c is { name: string; arguments: Record<string, unknown> } =>
          typeof c.name === 'string' && c.arguments !== undefined)
        .map((c, i) => ({
          'id':        `${idPrefix}-${String(seq)}-${String(i)}`,
          'name':      c.name,
          'arguments': c.arguments,
        }));
    } catch {
      return [];
    }
  }
}
