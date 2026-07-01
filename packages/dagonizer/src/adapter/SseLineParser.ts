/**
 * SseLineParser: isomorphic Server-Sent-Events framer.
 *
 * Decodes a raw byte stream (`ReadableStream<Uint8Array>`) into `SseFrameType`
 * frames per the SSE wire format: `event:`/`data:` lines accumulate, a blank
 * line flushes one frame, `:`-prefixed lines are comments and are ignored.
 * Multiple `data:` lines within one frame join with `\n` per spec. Built on
 * Web Streams + `TextDecoder` only (no `node:*` imports) so it runs unchanged
 * in the browser and in Node — every streaming LLM adapter (OpenAI-compatible,
 * Anthropic, Gemini API, …) drains its provider's SSE body through this one
 * parser.
 */

/** One parsed SSE frame: the optional `event:` name and the joined `data:` payload. */
export type SseFrameType = {
  readonly event: string | null;
  readonly data: string;
};

export class SseLineParser {
  private constructor() { /* static */ }

  /** Drain `stream` and yield one `SseFrameType` per blank-line-delimited SSE frame. */
  static async *linesOf(stream: ReadableStream<Uint8Array>): AsyncIterable<SseFrameType> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName: string | null = null;
    let dataLines: string[] = [];
    let hasData = false;

    const takeFrame = (): SseFrameType | null => {
      if (!hasData) return null;
      const frame: SseFrameType = { 'event': eventName, 'data': dataLines.join('\n') };
      eventName = null;
      dataLines = [];
      hasData = false;
      return frame;
    };

    const consumeLine = (rawLine: string): void => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0 || line.startsWith(':')) return;
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
        return;
      }
      if (line.startsWith('data:')) {
        // SSE spec: strip at most one leading space after the colon, not all
        // surrounding whitespace — a payload's meaningful inner/trailing
        // spaces must survive.
        const d = line.slice('data:'.length);
        dataLines.push(d.startsWith(' ') ? d.slice(1) : d);
        hasData = true;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { 'stream': true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          // Strip a trailing CR before the emptiness test: under CRLF line
          // endings a blank separator line arrives as "\r", and the frame must
          // still flush. SSE permits CR, LF, or CRLF terminators.
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          if (line.length === 0) {
            const frame = takeFrame();
            if (frame !== null) yield frame;
          } else {
            consumeLine(line);
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.length > 0) consumeLine(buffer);
      const finalFrame = takeFrame();
      if (finalFrame !== null) yield finalFrame;
    } finally {
      reader.releaseLock();
    }
  }
}
