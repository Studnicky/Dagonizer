/**
 * decompress: shared ingest transform — gzip bytes → plain text.
 *
 * The gzipped source carries its payload base64-encoded (a JSON-safe string
 * that round-trips through state snapshot/restore). This node base64-decodes
 * via atob then decompresses via the Web Streams DecompressionStream API
 * ('gzip'), writing the plain text to state.decodedText for the downstream
 * parse node. Compression is format-agnostic: any format may be gzipped and
 * will pass through this node to route-format, which selects the parser.
 * Runs in Node 18+ and browser environments without any Node-only imports.
 *
 * Routes 'route-format' on success; 'invalid' when the payload is not valid
 * gzip (the node never throws for malformed input — it routes).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region decompress-node
export class DecompressNode extends ScalarNode<CartographerState, 'route-format' | 'invalid', CartographerServices> {
  readonly 'name' = 'decompress';
  readonly 'outputs' = ['route-format', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'route-format' | 'invalid'>> {
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
    return NodeOutputBuilder.of('route-format');
  }
}

export const decompress = new DecompressNode();
// #endregion decompress-node
