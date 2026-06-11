import type { ToolCall } from './LlmAdapter.js';

/** JSON wire shape emitted by text-channel models that encode tool calls inline. */
interface TextChannelToolCallEnvelope {
  tool_calls?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
}

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
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < 0) return [];
      const parsed = JSON.parse(raw.slice(start, end + 1)) as TextChannelToolCallEnvelope;
      return (parsed.tool_calls ?? [])
        .filter((c): c is { name: string; arguments: Record<string, unknown> } =>
          typeof c.name === 'string' && c.arguments !== undefined)
        .map((c, i) => ({
          'id':        `${idPrefix}-${String(i)}-${String(Date.now())}`,
          'name':      c.name,
          'arguments': c.arguments,
        }));
    } catch {
      return [];
    }
  }
}
