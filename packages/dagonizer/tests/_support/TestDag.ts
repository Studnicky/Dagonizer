/**
 * TestDag: shared static factory for canonical JSON-LD DAG fixtures.
 *
 * Topology references are IRIs. Placement `name` stays available for display
 * and observability only; this helper never resolves a route, source, or
 * entrypoint through `name`.
 */

import { DAG_CONTEXT, DAGIdentity } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import { Placement } from '../../src/entities/dag/Placement.js';
import type { DAGNodeType } from '../../src/entities/dag/Placement.js';

export class TestDag {
  private constructor() { /* static class */ }

  /**
   * Build a minimal canonical `DAGType` skeleton.
   *
   * @param iri        - Registered DAG IRI.
   * @param entrypoint - Primary entrypoint placement IRI.
   * @param nodes      - Placement node definitions.
   */
  static of(
    iri: string,
    entrypoint: string,
    nodes: DAGType['nodes'],
    options: { readonly name?: string } = {},
  ): DAGType {
    return TestDag.withEntrypoints(iri, { 'main': entrypoint }, nodes, options);
  }

  /**
   * Build a canonical `DAGType` skeleton with one or more entrypoints.
   *
   * Entrypoint targets, route outputs, and gather producer sources must already
   * be canonical IRIs. Unknown IRIs throw immediately.
   */
  static withEntrypoints(
    iri: string,
    entrypoints: Readonly<Record<string, string>>,
    nodes: DAGType['nodes'],
    options: { readonly name?: string } = {},
  ): DAGType {
    const dagId = DAGIdentity.id(iri);
    const name = options.name ?? dagId;
    const placementsByIri = new Map(nodes.map((node) => [node['@id'], node]));
    const entrypointIris = new Set(Object.keys(entrypoints).map((label) => TestDag.entrypointIri(dagId, label)));
    const requirePlacementIri = (reference: string, context: string): string => {
      if (placementsByIri.has(reference)) return reference;
      throw new Error(`${context} must be a placement IRI in DAG '${name}' (got '${reference}')`);
    };
    const requireSourceIri = (reference: string, context: string): string => {
      if (placementsByIri.has(reference) || entrypointIris.has(reference)) return reference;
      throw new Error(`${context} must be a placement or entrypoint IRI in DAG '${name}' (got '${reference}')`);
    };

    return {
      '@context':  DAG_CONTEXT,
      '@id':       dagId,
      '@type':     'DAG',
      name,
      'version':   '1',
      'entrypoints': Object.fromEntries(
        Object.entries(entrypoints).map(([label, entrypoint]) => [
          label,
          requirePlacementIri(entrypoint, `DAG '${name}' entrypoint '${label}'`),
        ]),
      ),
      'nodes': nodes.map((node) => TestDag.materializeNode(node, requirePlacementIri, requireSourceIri)),
    };
  }

  /**
   * Canonicalize a hand-built DAG fixture without changing the placement bodies.
   *
   * Use this when a test needs custom `@context`, version, or labeled entrypoints
   * but should still exercise the canonical runtime contract.
   */
  static from(dag: DAGType): DAGType {
    const canonical = TestDag.withEntrypoints(dag['@id'], dag.entrypoints, dag.nodes, { 'name': dag.name });
    return {
      ...canonical,
      '@context': dag['@context'],
      '@id': dag['@id'],
      'version': dag.version,
    };
  }

  static placementIri(dagIri: string, placementId: string): string {
    return `${DAGIdentity.id(dagIri)}/node/${placementId}`;
  }

  static entrypointIri(dagIri: string, label: string): string {
    return `${DAGIdentity.id(dagIri)}/entrypoint/${encodeURIComponent(label)}`;
  }

  private static materializeNode(
    node: DAGNodeType,
    placementIri: (reference: string, context: string) => string,
    sourceIri: (reference: string, context: string) => string,
  ): DAGNodeType {
    if (Placement.isTerminal(node) || Placement.isPhase(node)) return node;
    if (Placement.isGather(node)) {
      return {
        ...node,
        'sources': Object.fromEntries(
          Object.entries(node.sources).map(([source, config]) => [
            sourceIri(source, `GatherNode '${node.name}' source '${source}'`),
            config,
          ]),
        ),
        'outputs': TestDag.materializeOutputs(node.name, node.outputs, placementIri),
      };
    }
    return {
      ...node,
      'outputs': TestDag.materializeOutputs(node.name, node.outputs, placementIri),
    };
  }

  private static materializeOutputs(
    placementDisplay: string,
    outputs: Record<string, string>,
    placementIri: (reference: string, context: string) => string,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(outputs).map(([outcome, target]) => [
        outcome,
        placementIri(target, `Placement '${placementDisplay}' output '${outcome}'`),
      ]),
    );
  }
}
