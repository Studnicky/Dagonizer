import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';
import { DagGraphProjector } from '../graph/DagGraphProjector.js';
import { DagGraphQueries } from '../graph/DagGraphQueries.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { JsonSchemaCompatibility } from '../schema/JsonSchemaCompatibility.js';
import { SchemaRegistry } from '../schema/SchemaRegistry.js';

export class DAGValidator {
  private constructor() { /* static class */ }

  static validateDAGConfig<TState extends NodeStateInterface>(
    dag: DAGType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): void {
    const errors: string[] = [];
    for (const node of dag.nodes) {
      DAGValidator.validateDAGNode(node, context, nodes, dags, errors);
    }
    DAGValidator.validateRouteSchemas(dag, nodes, errors);

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  static validateReferenceGraph(dags: ReadonlyMap<string, DAGType>): void {
    const errors: string[] = [];
    const edges = DAGValidator.referenceEdges(dags);

    for (const edge of edges) {
      if (!dags.has(edge.targetDagIri)) {
        errors.push(`DAG '${edge.sourceDagIri}' placement '${edge.sourcePlacement}' references unknown DAG '${edge.targetDagIri}'`);
      }
    }

    for (const component of DAGValidator.stronglyConnectedComponents(dags.keys(), edges)) {
      if (component.length === 1 && !DAGValidator.hasSelfEdge(component[0] ?? '', edges)) continue;
      DAGValidator.validateRecursiveComponent(component, dags, errors);
    }

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG registry graph:\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface>(
    entry: DAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGValidator.validateEmbeddedDAGNode(entry, context, dags, errors);
    } else if (Placement.isScatter(entry)) {
      DAGValidator.validateScatterNode(entry, context, nodes, dags, errors);
    } else if (Placement.isSingle(entry)) {
      DAGValidator.validateSingleNode(entry, context, nodes, errors);
    } else if (Placement.isGather(entry)) {
      DAGValidator.validateGatherNode(entry, context, nodes, errors);
    } else if (Placement.isPhase(entry)) {
      DAGValidator.validatePhaseNode(entry, context, nodes, errors);
    }
    // TerminalNode: no registry-relative references to validate.
  }

  private static validatePhaseNode<TState extends NodeStateInterface>(
    phase: PhaseNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(phase.node, context);
    if (!nodes.has(nodeIri)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface>(
    nodeConfig: SingleNodePlacementType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(nodeConfig.node, context);
    const dagNode = nodes.get(nodeIri);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      // 'parked' is a reserved engine-level output for HITL park-and-correlate.
      // The engine intercepts it before routing; no placement-level routing entry is required.
      if (output === 'parked') continue;
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if (placement.dag !== undefined) {
      DAGValidator.validateDagReference(placement.dag, context, dags, `EmbeddedDAGNode '${placement.name}'`, errors);
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface>(
    scatter: ScatterNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      const bodyNodeIri = ContextResolver.expand(scatter.body.node, context);
      if (!nodes.has(bodyNodeIri)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else if ('dag' in scatter.body) {
      DAGValidator.validateDagReference(scatter.body.dag, context, dags, `ScatterNode '${scatter.name}'`, errors);
    }

    DAGValidator.validateGatherConfig(scatter.name, scatter.gather, context, nodes, errors);
  }

  private static validateGatherNode<TState extends NodeStateInterface>(
    gatherNode: GatherNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    DAGValidator.validateGatherConfig(gatherNode.name, gatherNode.gather, context, nodes, errors);
  }

  private static validateGatherConfig<TState extends NodeStateInterface>(
    ownerName: string,
    gather: GatherConfigType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    if (gather.strategy === 'custom' && gather.customNode !== undefined) {
      const customNodeIri = ContextResolver.expand(gather.customNode, context);
      if (!nodes.has(customNodeIri)) {
        errors.push(`Gather '${ownerName}': custom gather node '${gather.customNode}' not found`);
      }
    }
  }

  private static validateDagReference(
    reference: DagReferenceType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    owner: string,
    errors: string[],
  ): void {
    for (const candidate of DagReference.candidates(reference)) {
      const dagIri = ContextResolver.expand(candidate, context);
      if (!dags.has(dagIri)) {
        errors.push(`${owner}: unknown registered DAG '${candidate}'`);
      }
    }
  }

  private static validateRouteSchemas<TState extends NodeStateInterface>(
    dag: DAGType,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const store = DagGraphProjector.store(dag);
    const schemas = new SchemaRegistry();
    DagGraphProjector.projectNodeSchemas({ dag, nodes, schemas, store });
    const dagIri = DagGraphProjector.dagIri(dag);

    for (const placement of dag.nodes) {
      if (!('outputs' in placement)) continue;
      const sourceIri = DagGraphProjector.placementIri(dagIri, placement.name);
      for (const [output, target] of Object.entries(placement.outputs)) {
        const producedIri = DagGraphQueries.placementOutputSchemaIri(store, sourceIri, output);
        if (producedIri === undefined) continue;
        const targetIri = DagGraphProjector.placementIri(dagIri, target);
        const requiredIri = DagGraphQueries.placementInputSchemaIri(store, targetIri);
        if (requiredIri === undefined) continue;
        const produced = schemas.get(producedIri);
        const required = schemas.get(requiredIri);
        if (produced === undefined || required === undefined) continue;

        const compatibility = JsonSchemaCompatibility.produces(produced, required);
        if (compatibility.status === 'incompatible') {
          errors.push(
            `Route '${placement.name}.${output}' -> '${target}' does not satisfy target input schema: ${compatibility.reason}`,
          );
        }
      }
    }
  }

  private static referenceEdges(dags: ReadonlyMap<string, DAGType>): readonly {
    readonly sourceDagIri: string;
    readonly sourcePlacement: string;
    readonly targetDagIri: string;
    readonly dynamic: boolean;
  }[] {
    const edges: {
      readonly sourceDagIri: string;
      readonly sourcePlacement: string;
      readonly targetDagIri: string;
      readonly dynamic: boolean;
    }[] = [];
    for (const [sourceDagIri, dag] of dags) {
      const topology = DagGraphProjector.store(dag);
      for (const row of DagGraphQueries.candidateDagRows(topology)) {
        edges.push({
          sourceDagIri,
          'sourcePlacement': DAGValidator.placementNameOf(row.placementIri),
          'targetDagIri': row.dagIri,
          'dynamic': row.dynamic,
        });
      }
    }
    return edges;
  }

  private static stronglyConnectedComponents(
    dagIris: Iterable<string>,
    edges: readonly { readonly sourceDagIri: string; readonly targetDagIri: string }[],
  ): readonly string[][] {
    const adjacency = new Map<string, string[]>();
    for (const dagIri of dagIris) adjacency.set(dagIri, []);
    for (const edge of edges) {
      const outgoing = adjacency.get(edge.sourceDagIri);
      if (outgoing !== undefined) outgoing.push(edge.targetDagIri);
    }

    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const components: string[][] = [];

    const visit = (dagIri: string): void => {
      indices.set(dagIri, index);
      lowlinks.set(dagIri, index);
      index += 1;
      stack.push(dagIri);
      onStack.add(dagIri);

      for (const target of adjacency.get(dagIri) ?? []) {
        if (!adjacency.has(target)) continue;
        if (!indices.has(target)) {
          visit(target);
          lowlinks.set(dagIri, Math.min(lowlinks.get(dagIri) ?? 0, lowlinks.get(target) ?? 0));
        } else if (onStack.has(target)) {
          lowlinks.set(dagIri, Math.min(lowlinks.get(dagIri) ?? 0, indices.get(target) ?? 0));
        }
      }

      if (lowlinks.get(dagIri) !== indices.get(dagIri)) return;
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === dagIri) break;
      }
      components.push(component);
    };

    for (const dagIri of adjacency.keys()) {
      if (!indices.has(dagIri)) visit(dagIri);
    }

    return components;
  }

  private static validateRecursiveComponent(
    component: readonly string[],
    dags: ReadonlyMap<string, DAGType>,
    errors: string[],
  ): void {
    for (const dagIri of component) {
      const dag = dags.get(dagIri);
      if (dag !== undefined && !DAGValidator.hasReachableTerminal(dag)) {
        errors.push(`Recursive DAG component containing '${dagIri}' has no terminal exit path`);
      }
    }
  }

  private static hasSelfEdge(
    dagIri: string,
    edges: readonly { readonly sourceDagIri: string; readonly targetDagIri: string }[],
  ): boolean {
    return edges.some((edge) => edge.sourceDagIri === dagIri && edge.targetDagIri === dagIri);
  }

  private static hasReachableTerminal(dag: DAGType): boolean {
    const placements = new Map<string, DAGNodeType>();
    for (const placement of dag.nodes) placements.set(placement.name, placement);

    const visited = new Set<string>();
    const queue = Object.values(dag.entrypoints);
    while (queue.length > 0) {
      const placementName = queue.shift();
      if (placementName === undefined || visited.has(placementName)) continue;
      visited.add(placementName);
      const placement = placements.get(placementName);
      if (placement === undefined) continue;
      if (Placement.isTerminal(placement)) return true;
      if ('outputs' in placement) queue.push(...Object.values(placement.outputs));
    }
    return false;
  }

  private static placementNameOf(placementIri: string): string {
    const marker = placementIri.lastIndexOf('#');
    return marker >= 0 ? decodeURIComponent(placementIri.slice(marker + 1)) : placementIri;
  }
}
