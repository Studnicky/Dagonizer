/**
 * WellFormedValidator: opt-in structural validator for authored DAG documents.
 *
 * Operates on an already-narrowed `DAG` (Ajv-validated wire shape). Inspects
 * placement structure to flag authoring errors that the type system cannot fully
 * catch (e.g. dangling route targets).
 *
 * Use from a CI lint script or a linting step in your authoring pipeline.
 * Never called by the runtime (Dagonizer.registerDAG stays unchanged).
 *
 * Usage:
 *   const violations = WellFormedValidator.check(dag);
 *   if (violations.length > 0) { ... }
 */

import type { DAGType } from '../entities/dag/DAG.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';

/**
 * Opt-in structural validator for authored DAG documents.
 * Returns an array of human-readable violation messages; empty = well-formed.
 * Pure function: no Ajv, no I/O, no side effects.
 *
 * Called after `Validator.dag` has accepted the document. Checks semantic
 * constraints that the schema cannot express (e.g. route targets must reference
 * real placement IRIs in the same DAG).
 */
export class WellFormedValidator {
  private constructor() { /* static class */ }

  /**
   * Check a DAG for well-formedness violations.
   *
   * Rules applied:
   *   1. All output targets must resolve to a placement IRI in dag.nodes.
   *
   * @param dag - A schema-validated DAG object.
   * @returns Array of human-readable violation messages. Empty = well-formed.
   */
  static check(dag: DAGType): readonly string[] {
    const violations: string[] = [];

    const placementIris = new Set<string>();
    const placementNames = new Set<string>();
    for (const placement of dag.nodes) {
      if (placementNames.has(placement.name)) {
        violations.push(`Duplicate placement name '${placement.name}'.`);
      }
      placementNames.add(placement.name);
      if (placementIris.has(placement['@id'])) {
        violations.push(`Duplicate placement IRI '${placement['@id']}'.`);
      }
      placementIris.add(placement['@id']);
    }

    WellFormedValidator.checkEntrypoints(dag, placementIris, violations);

    const producerLabels = WellFormedValidator.gatherProducerLabels(dag);

    for (const node of dag.nodes) {
      WellFormedValidator.checkPlacement(node, placementIris, producerLabels, violations);
    }

    return violations;
  }

  private static checkEntrypoints(
    dag: DAGType,
    placementIris: ReadonlySet<string>,
    violations: string[],
  ): void {
    for (const [label, target] of Object.entries(dag.entrypoints)) {
      if (label.length === 0) {
        violations.push(`Entrypoint label must be non-empty.`);
      }
      if (!placementIris.has(target)) {
        violations.push(`Entrypoint '${label}' targets '${target}', which does not exist in this DAG's placements.`);
      }
    }
  }

  private static checkPlacement(
    node: DAGNodeType,
    placementIris: ReadonlySet<string>,
    producerLabels: ReadonlySet<string>,
    violations: string[],
  ): void {
    // TerminalNode has no outputs; only check outcome.
    if (Placement.isTerminal(node)) {
      const outcome = node.outcome;
      if (outcome !== 'completed' && outcome !== 'failed') {
        violations.push(
          `Placement '${node.name}' (TerminalNode): outcome must be 'completed' or 'failed', got '${String(outcome)}'.`,
        );
      }
      return;
    }

    // PhaseNode has no outputs field (it is a lifecycle hook placement, not a routing placement).
    if (Placement.isPhase(node)) {
      return;
    }

    if ('outputs' in node) {
      WellFormedValidator.checkOutputTargets(node, placementIris, violations);
    }

    if (Placement.isGather(node)) {
      WellFormedValidator.checkGatherNode(node, producerLabels, violations);
    }
  }

  /**
   * Validate that every output route target references an existing placement IRI.
   * Applies to SingleNode, ScatterNode, and EmbeddedDAGNode.
   */
  private static checkOutputTargets(
    node: DAGNodeType & { outputs: Record<string, string> },
    placementIris: ReadonlySet<string>,
    violations: string[],
  ): void {
    for (const [route, target] of Object.entries(node.outputs)) {
      if (!placementIris.has(target)) {
        violations.push(
          `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
        );
      }
    }
  }

  private static checkGatherNode(
    gather: GatherNodeType,
    producerLabels: ReadonlySet<string>,
    violations: string[],
  ): void {
    for (const source of Object.keys(gather.sources)) {
      if (!producerLabels.has(source)) {
        violations.push(
          `GatherNode '${gather.name}': source '${source}' is not declared by an entrypoint or producer placement.`,
        );
      }
    }
    if (gather.policy?.quorum !== undefined && gather.policy.mode !== 'quorum') {
      violations.push(`GatherNode '${gather.name}': policy.quorum is only valid when policy.mode is 'quorum'.`);
    }
    const sourceCount = Object.keys(gather.sources).length;
    if (gather.policy?.mode === 'quorum' && gather.policy.quorum !== undefined && gather.policy.quorum > sourceCount) {
      violations.push(`GatherNode '${gather.name}': policy.quorum ${gather.policy.quorum} exceeds source count ${sourceCount}.`);
    }
  }

  private static gatherProducerLabels(dag: DAGType): ReadonlySet<string> {
    const labels = new Set(Object.entries(dag.entrypoints).map(([label]) => `${dag['@id']}/entrypoint/${encodeURIComponent(label)}`));
    const gatherNames = new Set(
      dag.nodes
        .filter((node) => Placement.isGather(node))
        .map((node) => node['@id']),
    );

    for (const node of dag.nodes) {
      if (!('outputs' in node)) continue;
      if (Object.values(node.outputs).some((target) => gatherNames.has(target))) {
        labels.add(node['@id']);
      }
    }

    return labels;
  }
}
