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
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

/** Stable JSON-LD vocabulary URI for the Dagonizer DAG vocabulary. */
export const DAGONIZER_VOCAB = 'https://noocodex.dev/ontology/dagonizer/';

type DAGNodeEntry = ScatterNode | ParallelNode | SingleNodePlacementInterface | TerminalNodePlacementInterface;

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

/**
 * Render a `DAG` as JSON-LD. The output document has a stable
 * `@context` plus a `@graph` containing the DAG root and every
 * placement, all typed against the Dagonizer vocabulary.
 */
export class JsonLdRenderer {
  private constructor() { /* static class */ }

  /** Mapping from JSON-LD placement-discriminator to vocabulary-prefixed `@type`. */
  private static readonly TYPE_BY_KIND: Readonly<Record<DAGNodeEntry['@type'], string>> = {
    'SingleNode':   'dag:SingleNode',
    'ParallelNode': 'dag:ParallelNode',
    'ScatterNode':  'dag:ScatterNode',
    'TerminalNode': 'dag:TerminalNode',
  };

  static render(dag: DAG): DagJsonLdDocument {
    const placements = (dag.nodes as readonly DAGNodeEntry[]).map((placement) =>
      JsonLdRenderer.renderPlacement(dag.name, placement),
    );

    return {
      '@context': {
        'dag':         DAGONIZER_VOCAB,
        'xsd':         'http://www.w3.org/2001/XMLSchema#',
      },
      '@graph': [JsonLdRenderer.renderDagRoot(dag), ...placements],
    };
  }

  /** Build the URN identifying one placement inside a DAG. */
  private static placementIri(dagName: string, placementName: string): string {
    return `urn:dagonizer:${dagName}#${placementName}`;
  }

  /** Build the URN identifying a DAG document. */
  private static dagIri(dagName: string): string {
    return `urn:dagonizer:${dagName}`;
  }

  /**
   * Convert a routing map to JSON-LD route descriptors that reference
   * the full placement IRIs (so consumers don't have to re-resolve
   * names).
   */
  private static renderRoutes(
    dagName: string,
    outputs: Readonly<Record<string, string | null>>,
  ): readonly { readonly 'dag:output': string; readonly 'dag:target': string | null }[] {
    const routes: { readonly 'dag:output': string; readonly 'dag:target': string | null }[] = [];
    for (const [output, target] of Object.entries(outputs)) {
      routes.push({
        'dag:output': output,
        'dag:target': target === null ? null : JsonLdRenderer.placementIri(dagName, target),
      });
    }
    return routes;
  }

  /** Render one placement as a JSON-LD `@graph` entry. */
  private static renderPlacement(dagName: string, placement: DAGNodeEntry): JsonLdGraphEntry {
    const base = {
      '@id':      JsonLdRenderer.placementIri(dagName, placement.name),
      '@type':    JsonLdRenderer.TYPE_BY_KIND[placement['@type']],
      'dag:name': placement.name,
    } as const;

    switch (placement['@type']) {
      case 'SingleNode':
        return {
          ...base,
          'dag:routes': JsonLdRenderer.renderRoutes(dagName, placement.outputs),
          'dag:node':   placement.node,
        };
      case 'ParallelNode':
        return {
          ...base,
          'dag:routes':   JsonLdRenderer.renderRoutes(dagName, placement.outputs),
          'dag:combine':  placement.combine,
          'dag:children': placement.nodes.map((child: string) => JsonLdRenderer.placementIri(dagName, child)),
        };
      case 'ScatterNode': {
        const out: JsonLdGraphEntry & Record<string, unknown> = {
          ...base,
          'dag:routes': JsonLdRenderer.renderRoutes(dagName, placement.outputs),
          'dag:body':   'node' in placement.body
            ? { 'dag:node': placement.body.node }
            : { 'dag:dag': JsonLdRenderer.dagIri(placement.body.dag) },
        };
        if (placement.source !== undefined)      out['dag:source']      = placement.source;
        if (placement.itemKey !== undefined)     out['dag:itemKey']     = placement.itemKey;
        if (placement.concurrency !== undefined) out['dag:concurrency'] = placement.concurrency;
        if (placement.projection !== undefined)  out['dag:projection']  = placement.projection;
        if (placement.gather !== undefined)      out['dag:gather']      = placement.gather;
        if (placement.reducer !== undefined)     out['dag:reducer']     = placement.reducer;
        return out;
      }
      case 'TerminalNode':
        // TerminalNode placements end the flow — no routing, no dag:routes field.
        return {
          ...base,
          'dag:outcome': placement.outcome,
        };
    }
  }

  /** Render the DAG-level root entry that points at every placement. */
  private static renderDagRoot(dag: DAG): JsonLdGraphEntry {
    return {
      '@id':            JsonLdRenderer.dagIri(dag.name),
      '@type':          'dag:DAG',
      'dag:name':       dag.name,
      'dag:version':    dag.version,
      'dag:entrypoint': JsonLdRenderer.placementIri(dag.name, dag.entrypoint),
      'dag:placements': dag.nodes.map((placement) =>
        JsonLdRenderer.placementIri(dag.name, placement.name),
      ),
    };
  }
}
