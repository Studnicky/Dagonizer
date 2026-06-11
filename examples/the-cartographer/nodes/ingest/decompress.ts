/**
 * decompress: shared ingest transform — gzip(NDJSON) bytes → NDJSON text.
 *
 * The gzipped NDJSON source carries its payload base64-encoded (a JSON-safe
 * string that round-trips through state snapshot/restore). This node base64-
 * decodes via atob then decompresses via the Web Streams DecompressionStream
 * API ('gzip'), writing the plain NDJSON text to state.decodedText for the
 * parse-ndjson node. Runs in Node 18+ and browser environments without any
 * Node-only imports.
 *
 * Routes 'parse-ndjson' on success; 'invalid' when the payload is not valid
 * gzip (the node never throws for malformed input — it routes).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region decompress-node
export class DecompressNode implements NodeInterface<CartographerState, 'parse-ndjson' | 'invalid', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'decompress';
  readonly 'outputs' = ['parse-ndjson', 'invalid'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'parse-ndjson' | 'invalid'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    try {
      const binary = atob(state.currentSource.payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      void writer.write(bytes);
      void writer.close();
      const chunks: Uint8Array[] = [];
      const reader = ds.readable.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      let total = 0; for (const c of chunks) total += c.length;
      const merged = new Uint8Array(total);
      let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
      state.decodedText = new TextDecoder().decode(merged);
    } catch {
      return NodeOutputBuilder.of('invalid');
    }
    return NodeOutputBuilder.of('parse-ndjson');
  }
}
// #endregion decompress-node
