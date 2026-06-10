import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { DAG } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodePlacementInterface } from '../entities/dag/PhaseNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import { DAGError, ValidationError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class DAGValidator {
  private constructor() { /* static class */ }

  static validateDAGConfig<TState extends NodeStateInterface, TServices>(
    dag: DAG,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
  ): void {
    const errors: string[] = [];
    const nodeNames = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
    }

    if (!nodeNames.has(dag.entrypoint)) {
      errors.push(`Entrypoint '${dag.entrypoint}' does not exist in nodes`);
    }

    for (const node of dag.nodes) {
      DAGValidator.validateDAGNode(node, nodes, dags, nodeNames, errors);
    }

    // Collect circular-reference candidates across BOTH sub-DAG edge kinds in
    // one traversal: EmbeddedDAGNode(dag) and ScatterNode(body.dag). A
    // cross-kind cycle (embed → scatter → embed) is caught, not just same-kind.
    const dagRefs = new Set<string>();
    DAGValidator.collectDAGReferences(dag, dags, dagRefs, new Set([dag.name]), errors);

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface, TServices>(
    entry: DAGNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if (entry['@type'] === 'EmbeddedDAGNode') {
      DAGValidator.validateEmbeddedDAGNode(entry, dags, nodeNames, errors);
    } else if (entry['@type'] === 'ScatterNode') {
      DAGValidator.validateScatterNode(entry, nodes, dags, nodeNames, errors);
    } else if (entry['@type'] === 'SingleNode') {
      DAGValidator.validateSingleNode(entry, nodes, nodeNames, errors);
    } else if (entry['@type'] === 'PhaseNode') {
      DAGValidator.validatePhaseNode(entry, nodes, errors);
    }
    // TerminalNode: no outputs to validate; schema pass is sufficient.
  }

  private static validatePhaseNode<TState extends NodeStateInterface, TServices>(
    phase: PhaseNodePlacementInterface,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    errors: string[],
  ): void {
    if (!nodes.has(phase.node)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface, TServices>(
    nodeConfig: SingleNodePlacementInterface,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    const dagNode = nodes.get(nodeConfig.node);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }

    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNode,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if (!dags.has(placement.dag)) {
      errors.push(`EmbeddedDAGNode '${placement.name}': unknown registered DAG '${placement.dag}'`);
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface, TServices>(
    scatter: ScatterNode,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      // A node body with a container key is invalid: a node body is one node, not a DAG.
      // Container is only valid for dag bodies. Throw immediately — this is a structural
      // error that must surface before any execution.
      if ('container' in scatter && (scatter as { container?: string }).container !== undefined) {
        throw new ValidationError(
          `ScatterNode '${scatter.name}' has a node body; 'container' is only valid for a dag body`,
        );
      }
      if (!nodes.has(scatter.body.node)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else {
      if (!dags.has(scatter.body.dag)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered DAG '${scatter.body.dag}'`);
      }
    }

    const gather = scatter.gather;
    if (gather.strategy === 'append' && gather.target === undefined) {
      errors.push(`ScatterNode '${scatter.name}': 'append' gather strategy requires 'target' path`);
    }
    if (gather.strategy === 'collect' && gather.target === undefined) {
      errors.push(`ScatterNode '${scatter.name}': 'collect' gather strategy requires 'target' path`);
    }
    if (gather.strategy === 'partition' && gather.partitions === undefined) {
      errors.push(`ScatterNode '${scatter.name}': 'partition' gather strategy requires 'partitions' config`);
    }
    if (gather.strategy === 'map' && gather.mapping === undefined) {
      errors.push(`ScatterNode '${scatter.name}': 'map' gather strategy requires 'mapping' config`);
    }
    if (gather.strategy === 'custom') {
      if (gather.customNode === undefined) {
        errors.push(`ScatterNode '${scatter.name}': 'custom' gather strategy requires 'customNode'`);
      } else if (!nodes.has(gather.customNode)) {
        errors.push(`ScatterNode '${scatter.name}': custom gather node '${gather.customNode}' not found`);
      }
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`ScatterNode '${scatter.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  /**
   * Depth-first cycle detection over the sub-DAG reference graph. Follows BOTH
   * sub-DAG edge kinds in a single traversal: `EmbeddedDAGNode.dag` (embed) and
   * `ScatterNode.body.dag` (fork-of-sub-DAG), so a cross-kind cycle is caught.
   * `path` is the current DFS stack (back-edge ⇒ cycle); `visited` marks
   * fully-explored DAGs so shared sub-DAGs are not re-walked.
   */
  private static collectDAGReferences(
    dag: DAG,
    dags: Map<string, DAG>,
    visited: Set<string>,
    path: Set<string>,
    errors: string[],
  ): void {
    for (const rawNode of dag.nodes) {
      let dagRef: string;
      let label: string;
      if (rawNode['@type'] === 'EmbeddedDAGNode') {
        dagRef = rawNode.dag;
        label = 'embedded-DAG';
      } else if (rawNode['@type'] === 'ScatterNode') {
        const body = rawNode.body;
        if (!('dag' in body)) continue;
        dagRef = body.dag;
        label = 'scatter';
      } else {
        continue;
      }
      if (path.has(dagRef)) {
        errors.push(`Circular ${label} DAG reference detected: ${Array.from(path).join(' -> ')} -> ${dagRef}`);
        continue;
      }
      if (!visited.has(dagRef)) {
        visited.add(dagRef);
        const nested = dags.get(dagRef);
        if (nested) {
          const newPath = new Set(path);
          newPath.add(dagRef);
          DAGValidator.collectDAGReferences(nested, dags, visited, newPath, errors);
        }
      }
    }
  }
}
