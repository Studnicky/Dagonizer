import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

import type { EmbedderProvisionOptionsType } from '../../the-archivist/providers/EmbedderProvisioner.ts';

let provisionPromise: Promise<EmbedderInterface> | null = null;

export class DispatcherEmbedderProvisioner {
  static provision(options: EmbedderProvisionOptionsType = {}): Promise<EmbedderInterface> {
    if (provisionPromise === null) {
      provisionPromise = DispatcherEmbedderProvisioner.provisionTransformer(options).then(
        (embedder) => embedder,
        (error) => {
          provisionPromise = null;
          throw error;
        },
      );
    }
    return provisionPromise;
  }

  private static async provisionTransformer(
    options: EmbedderProvisionOptionsType,
  ): Promise<EmbedderInterface> {
    const { TransformersEmbedder } = await import('@studnicky/dagonizer-embedder-transformers');
    const embedder = new TransformersEmbedder({
      ...(options.transformersLocalModelPath !== undefined
        ? { 'localModelPath': options.transformersLocalModelPath }
        : {}),
      ...(options.transformersWasmPaths !== undefined
        ? { 'wasmPaths': options.transformersWasmPaths }
        : {}),
    });
    if (!(await embedder.probe())) {
      throw new Error('transformer embedder probe failed');
    }
    await embedder.connect();
    return embedder;
  }
}
