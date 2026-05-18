/**
 * JsonLdRenderer — render a `DAG` as JSON-LD.
 *
 * JSON-LD is the canonical interchange format for the noocodex stack
 * (matches the json-tology / cartographus / sigil vocabulary). The
 * output is a single document with a `@context` and a `@graph` that
 * contains every placement in the DAG plus the DAG itself as the root.
 *
 * Use cases:
 *   - Hand a DAG to another tool (visualizer, ontology projector,
 *     dependency analyzer) that consumes JSON-LD.
 *   - Persist a runtime topology snapshot alongside other RDF assets.
 *   - Drive interactive renderers (Cytoscape, D3) that prefer typed
 *     graph payloads over Mermaid source text.
 *
 * Static class. The renderer does not invoke any IO; it returns a
 * plain object the caller serializes with `JSON.stringify`.
 *
 * @example
 * ```ts
 * import { JsonLdRenderer } from '@noocodex/dagonizer/viz';
 *
 * const doc = JsonLdRenderer.render(dispatcher.getDAG('pipeline')!);
 * await fs.writeFile('pipeline.jsonld', JSON.stringify(doc, null, 2));
 * ```
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';

/** Stable JSON-LD vocabulary URI for the Dagonizer DAG vocabulary. */
export const DAGONIZER_VOCAB = 'https://noocodex.dev/ontology/dagonizer/';

type DAGNodeEntry = FanOutNode | ParallelNode | SingleNodePlacementInterface | DeepDAGNode;

/** A single node entry in the rendered `@graph`. */
export interface JsonLdGraphEntry {
  readonly '@id': string;
  readonly '@type': string;
  readonly [key: string]: unknown;
}

/** Full JSON-LD document the renderer emits. */
export interface DagJsonLdDocument {
  readonly '@context': Record<string, string>;
  readonly '@graph': readonly JsonLdGraphEntry[];
}

const TYPE_BY_KIND: Readonly<Record<DAGNodeEntry['@type'], string>> = {
  'SingleNode':  'dag:SingleNode',
  'ParallelNode': 'dag:ParallelNode',
  'FanOutNode':  'dag:FanOutNode',
  'DeepDAGNode': 'dag:DeepDAGNode',
};

const placementIri = (dagName: string, placementName: string): string =>
  `urn:dagonizer:${dagName}#${placementName}`;

const dagIri = (dagName: string): string => `urn:dagonizer:${dagName}`;

/** Convert a routing map to JSON-LD route descriptors that reference the
 *  full placement IRIs (so consumers don't have to re-resolve names). */
const renderRoutes = (
  dagName: string,
  outputs: Readonly<Record<string, string | null>>,
): readonly { readonly 'dag:output': string; readonly 'dag:target': string | null }[] => {
  const routes: { readonly 'dag:output': string; readonly 'dag:target': string | null }[] = [];
  for (const [output, target] of Object.entries(outputs)) {
    routes.push({
      'dag:output': output,
      'dag:target': target === null ? null : placementIri(dagName, target),
    });
  }
  return routes;
};

const renderPlacement = (dagName: string, placement: DAGNodeEntry): JsonLdGraphEntry => {
  const base = {
    '@id': placementIri(dagName, placement.name),
    '@type': TYPE_BY_KIND[placement['@type']],
    'dag:name': placement.name,
    'dag:routes': renderRoutes(dagName, placement.outputs),
  } as const;

  switch (placement['@type']) {
    case 'SingleNode':
      return { ...base, 'dag:node': placement.node };
    case 'ParallelNode':
      return {
        ...base,
        'dag:combine': placement.combine,
        'dag:children': placement.nodes.map((child: string) => placementIri(dagName, child)),
      };
    case 'FanOutNode': {
      const out: JsonLdGraphEntry & Record<string, unknown> = {
        ...base,
        'dag:node':   placement.node,
        'dag:source': placement.source,
        'dag:fanIn':  placement.fanIn,
      };
      if (placement.itemKey !== undefined)     out['dag:itemKey']     = placement.itemKey;
      if (placement.concurrency !== undefined) out['dag:concurrency'] = placement.concurrency;
      return out;
    }
    case 'DeepDAGNode': {
      const out: JsonLdGraphEntry & Record<string, unknown> = {
        ...base,
        'dag:dag': dagIri(placement.dag),
      };
      if (placement.stateMapping !== undefined) out['dag:stateMapping'] = placement.stateMapping;
      return out;
    }
  }
};

const renderDagRoot = (dag: DAG): JsonLdGraphEntry => ({
  '@id':   dagIri(dag.name),
  '@type': 'dag:DAG',
  'dag:name':       dag.name,
  'dag:version':    dag.version,
  'dag:entrypoint': placementIri(dag.name, dag.entrypoint),
  'dag:placements': dag.nodes.map((placement) =>
    placementIri(dag.name, placement.name),
  ),
});

/**
 * Render a `DAG` as JSON-LD. The output document has a stable
 * `@context` plus a `@graph` containing the DAG root and every
 * placement, all typed against the Dagonizer vocabulary.
 */
export class JsonLdRenderer {
  private constructor() { /* static class */ }

  static render(dag: DAG): DagJsonLdDocument {
    const placements = (dag.nodes as readonly DAGNodeEntry[]).map((placement) =>
      renderPlacement(dag.name, placement),
    );

    return {
      '@context': {
        'dag':         DAGONIZER_VOCAB,
        'xsd':         'http://www.w3.org/2001/XMLSchema#',
      },
      '@graph': [renderDagRoot(dag), ...placements],
    };
  }
}
