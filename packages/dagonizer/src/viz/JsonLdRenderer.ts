/**
 * JsonLdRenderer: render a `DAG` as JSON-LD.
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
 * import { JsonLdRenderer } from '@studnicky/dagonizer/viz';
 *
 * const doc = JsonLdRenderer.render(dispatcher.getDAG('pipeline')!);
 * await fs.writeFile('pipeline.jsonld', JSON.stringify(doc, null, 2));
 * ```
 */

import type { FromSchema } from 'json-schema-to-ts';

import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import { DagGraphProjector } from '../graph/DagGraphProjector.js';
import { PluginDiscovery } from '../plugin/PluginDiscovery.js';

import { PlacementUtils } from './internal.js';
import type { PlacementDispatchType, PlacementEntryType } from './internal.js';

/** Stable JSON-LD vocabulary URI for the Dagonizer DAG vocabulary. */
export const DAGONIZER_VOCAB = 'https://noocodex.dev/ontology/dagonizer/';

/**
 * JSON Schema 2020-12 definition for the top-level JSON-LD document
 * the renderer emits. The `@graph` array holds open-ended graph entries
 * because JSON-LD graph entries carry arbitrary vocabulary-prefixed
 * property keys (e.g. `dag:routes`, `dag:outcome`) that cannot be
 * enumerated at the schema level. The top-level document shape is
 * precise: `@context` is a string-to-string map and `@graph` is an
 * array of objects that always carry `@id` and `@type` strings.
 *
 * This is a viz-specific output schema. It describes the document shape
 * emitted by `JsonLdRenderer` and is not part of the entities taxonomy
 * (i.e. it does not live under `src/entities/` and is not registered
 * with `Validator`). It lives here because it characterises viz output,
 * not DAG structure.
 */
export const DagJsonLdDocumentSchema = {
  '$id':     'https://noocodex.dev/schemas/dagonizer/DagJsonLdDocument',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@context', '@graph'],
  'additionalProperties': false,
  'properties': {
    '@context': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    '@graph': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['@id', '@type'],
        'properties': {
          '@id':   { 'type': 'string' },
          '@type': { 'type': 'string' },
        },
        'additionalProperties': true,
      },
    },
  },
} as const;

/**
 * A single node entry in the rendered `@graph`.
 *
 * JSON-LD graph entries carry arbitrary vocabulary-prefixed keys
 * (e.g. `dag:routes`, `dag:name`, `dag:outcome`) that vary by
 * placement type. The open index signature reflects this genuine
 * wire-shape requirement; `@id` and `@type` are always present and
 * precisely typed.
 */
export type JsonLdGraphEntryType = {
  '@id': string;
  '@type': string;
  [key: string]: unknown;
}

/** Full JSON-LD document the renderer emits. Derived from `DagJsonLdDocumentSchema`. */
export type DagJsonLdDocumentType = FromSchema<typeof DagJsonLdDocumentSchema>;

/**
 * Render a `DAG` as JSON-LD. The output document has a stable
 * `@context` plus a `@graph` containing the DAG root and every
 * placement, all typed against the Dagonizer vocabulary.
 */
export class JsonLdRenderer {
  private constructor() { /* static class */ }

  /** Mapping from JSON-LD placement-discriminator to vocabulary-prefixed `@type`. */
  private static readonly TYPE_BY_KIND: Readonly<Record<PlacementEntryType['@type'], string>> = {
    'SingleNode':      'dag:SingleNode',
    'ScatterNode':     'dag:ScatterNode',
    'EmbeddedDAGNode': 'dag:EmbeddedDAGNode',
    'GatherNode':      'dag:GatherNode',
    'TerminalNode':    'dag:TerminalNode',
    'PhaseNode':       'dag:PhaseNode',
  };

  static render(dag: DAGType): DagJsonLdDocumentType {
    const context = ContextResolver.contextOf(dag['@context']);
    const dagIri = DagGraphProjector.dagIri(dag);
    const placements = PlacementUtils.narrowNodes(dag).map((placement) =>
      JsonLdRenderer.renderPlacement(dagIri, context, placement),
    );

    return {
      '@context': {
        'dag':         DAGONIZER_VOCAB,
        'xsd':         'http://www.w3.org/2001/XMLSchema#',
      },
      '@graph': [JsonLdRenderer.renderDagRoot(dag, dagIri), ...placements],
    };
  }

  /**
   * Render the entry DAG plus all reachable literal embedded DAGs into one
   * JSON-LD document.
   */
  static renderReachable(entryDag: DAGType, registry: ReadonlyMap<string, DAGType>): DagJsonLdDocumentType {
    const graph: JsonLdGraphEntryType[] = [];
    const seenIds = new Set<string>();
    const dagIris = PluginDiscovery.walk(entryDag, registry);
    const entryDagIri = DagGraphProjector.dagIri(entryDag);

    for (const dagIri of dagIris) {
      const dag = dagIri === entryDagIri ? entryDag : registry.get(dagIri);
      if (dag === undefined) continue;
      const rendered = JsonLdRenderer.render(dag);
      for (const entry of rendered['@graph']) {
        const id = entry['@id'];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        graph.push(entry);
      }
    }

    return {
      '@context': {
        'dag': DAGONIZER_VOCAB,
        'xsd': 'http://www.w3.org/2001/XMLSchema#',
      },
      '@graph': graph,
    };
  }

  private static renderDagReference(reference: DagReferenceType, context: Record<string, unknown>): unknown {
    if (typeof reference === 'string') {
      return ContextResolver.expand(reference, context);
    }
    return {
      '@type': 'dag:DagReference',
      'dag:from': reference.from,
      'dag:path': reference.path,
      'dag:candidateDag': reference.candidates.map((candidate) => ContextResolver.expand(candidate, context)),
    };
  }

  private static renderDagReferenceNode(
    reference: DagReferenceType,
    ownerPlacementIri: string,
    context: Record<string, unknown>,
  ): JsonLdGraphEntryType {
    const candidates = (typeof reference === 'string' ? [reference] : reference.candidates)
      .map((candidate) => ContextResolver.expand(candidate, context));
    const out: JsonLdGraphEntryType & Record<string, unknown> = {
      '@id': `${ownerPlacementIri}/dag-reference`,
      '@type': 'dag:DagReference',
      'dag:candidateDag': candidates,
    };
    if (typeof reference !== 'string') {
      out['dag:from'] = reference.from;
      out['dag:path'] = reference.path;
    }
    return out;
  }

  /**
   * Convert a routing map to JSON-LD route descriptors that reference
   * the full placement IRIs (so consumers don't have to re-resolve
   * names).
   */
  private static renderRoutes(
    dagIri: string,
    outputs: Readonly<Record<string, string>>,
  ): readonly { readonly 'dag:output': string; readonly 'dag:target': string }[] {
    const routes: { readonly 'dag:output': string; readonly 'dag:target': string }[] = [];
    for (const [output, target] of Object.entries(outputs)) {
      routes.push({
        'dag:output': output,
        'dag:target': DagGraphProjector.placementIri(dagIri, target),
      });
    }
    return routes;
  }

  /** Render one placement as a JSON-LD `@graph` entry. */
  private static renderPlacement(
    dagIri: string,
    context: Record<string, unknown>,
    placement: PlacementEntryType,
  ): JsonLdGraphEntryType {
    const base = {
      '@id':      DagGraphProjector.placementIri(dagIri, placement.name),
      '@type':    JsonLdRenderer.TYPE_BY_KIND[placement['@type']],
      'dag:name': placement.name,
    } as const;
    const placementIri = base['@id'];

    const placementDispatch: PlacementDispatchType<JsonLdGraphEntryType> = {
      'SingleNode': (sp) => {
        return {
          ...base,
          'dag:routes': JsonLdRenderer.renderRoutes(dagIri, sp.outputs),
          'dag:node':   sp.node,
        };
      },
      'ScatterNode': (sp) => {
        // ScatterNode carries several optional fields (source, itemKey, execution,
        // stateMapping, gather, reducer, container). Build a mutable accumulator
        // then freeze on return. The open index is required because JSON-LD
        // property keys are arbitrary vocabulary-prefixed strings.
        const out: JsonLdGraphEntryType & Record<string, unknown> = {
          ...base,
          'dag:routes': JsonLdRenderer.renderRoutes(dagIri, sp.outputs),
          'dag:body':   'node' in sp.body
            ? { 'dag:node': sp.body.node }
            : { 'dag:dag': JsonLdRenderer.renderDagReference(sp.body.dag, context) },
        };
        if ('dag' in sp.body) out['dag:dagReference'] = JsonLdRenderer.renderDagReferenceNode(sp.body.dag, placementIri, context);
        if (sp.source !== undefined)       out['dag:source']       = sp.source;
        if (sp.itemKey !== undefined)      out['dag:itemKey']      = sp.itemKey;
        if (sp.execution !== undefined)    out['dag:execution']    = sp.execution;
        if (sp.stateMapping !== undefined) out['dag:stateMapping'] = sp.stateMapping;
        if (sp.gather !== undefined)       out['dag:gather']       = sp.gather;
        if (sp.reducer !== undefined)      out['dag:reducer']      = sp.reducer;
        // container is a placement property mapped in DAG_CONTEXT; include when present.
        if (sp.container !== undefined)    out['dag:container']    = sp.container;
        return out;
      },
      'EmbeddedDAGNode': (ep) => {
        // EmbeddedDAGNode may carry optional stateMapping, gatherResult, and container fields.
        const out: JsonLdGraphEntryType & Record<string, unknown> = {
          ...base,
          'dag:routes': JsonLdRenderer.renderRoutes(dagIri, ep.outputs),
        };
        if (ep.dag !== undefined) {
          out['dag:dag'] = JsonLdRenderer.renderDagReference(ep.dag, context);
          out['dag:dagReference'] = JsonLdRenderer.renderDagReferenceNode(ep.dag, placementIri, context);
        }
        if (ep.stateMapping !== undefined) out['dag:stateMapping'] = ep.stateMapping;
        if (ep.gatherResult !== undefined) out['dag:gatherResult'] = ep.gatherResult;
        // container is a placement property mapped in DAG_CONTEXT; include when present.
        if (ep.container !== undefined)    out['dag:container']    = ep.container;
        return out;
      },
      'GatherNode': (gp) => {
        return {
          ...base,
          'dag:sources': gp.sources,
          'dag:gather': gp.gather,
          'dag:policy': gp.policy,
          'dag:routes': JsonLdRenderer.renderRoutes(dagIri, gp.outputs),
        };
      },
      'TerminalNode': (tp) => {
        // TerminalNode placements end the flow; no routing, no dag:routes field.
        return {
          ...base,
          'dag:outcome': tp.outcome,
        };
      },
      'PhaseNode': (pp) => {
        // PhaseNode placements are out-of-band; they have no outputs/routes.
        return {
          ...base,
          'dag:phase': pp.phase,
          'dag:node':  pp.node,
        };
      },
    };

    return PlacementUtils.invoke(placementDispatch, placement);
  }

  /** Render the DAG-level root entry that points at every placement. */
  private static renderDagRoot(dag: DAGType, dagIri: string): JsonLdGraphEntryType {
    return {
      '@id':            dagIri,
      '@type':          'dag:DAG',
      'dag:name':       dag.name,
      'dag:version':    dag.version,
      'dag:entrypoints': Object.fromEntries(
        Object.entries(dag.entrypoints).map(([label, entrypoint]) => [
          label,
          DagGraphProjector.placementIri(dagIri, entrypoint),
        ]),
      ),
      'dag:placements': dag.nodes.map((placement) =>
        DagGraphProjector.placementIri(dagIri, placement.name),
      ),
    };
  }
}
