/**
 * Render the Archivist DAG as a JSON-LD document.
 *
 * Calls `JsonLdRenderer.render(archivistDAG)` and logs the serialized
 * document to stdout. The document uses the stable `DAGONIZER_VOCAB`
 * URI as its `dag:` prefix, making it consumable by any RDF-aware tool
 * in the noocodex stack (cartographus, sigil, ontology projectors).
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-jsonld.ts
 * ```
 */

// #region jsonld-render
import { JsonLdRenderer, DAGONIZER_VOCAB } from '@studnicky/dagonizer/viz';

import { archivistDAG } from '../dag.ts';

const doc = JsonLdRenderer.render(archivistDAG);

// DAGONIZER_VOCAB is the stable @context prefix for all dag: terms.
console.log(`// vocab: ${DAGONIZER_VOCAB}`);
console.log(JSON.stringify(doc, null, 2));
// #endregion jsonld-render
