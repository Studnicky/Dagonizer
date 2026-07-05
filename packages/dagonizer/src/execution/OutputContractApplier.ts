/**
 * OutputContractApplier: the output-schema validation lifecycle stage.
 *
 * This is the engine's dedicated VALIDATE stage — it runs between a node firing
 * (`execute`) and its routed output being pushed downstream, never folded into
 * `execute` itself. The scheduler's work-set loop invokes it as an explicit step
 * (`fire → validate → route`); the scatter path invokes it again at each per-item
 * emit into the gather. It is the single place output contracts are enforced.
 *
 * Covers all Monadic nodes uniformly. Given a node's `RoutedBatchType`,
 * on a per-port violation it re-routes the offending item to `'error'` and
 * collects a `NodeError` (code `outputContractViolation`) on the item's state.
 * When `validateOutputs` is off (validator is null) the call is a no-op — zero
 * overhead (a single null-check), byte-identical to pre-contract routing.
 *
 * Ports are plain strings at this stage: a node's routed output is already
 * widened to `string` keys by the dispatch funnel, so `'error'` is a routable
 * port literal with no cast.
 */

import type { OutputSchemaValidatorInterface, SchemaObjectType } from '../contracts/NodeInterface.js';
import { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/** The port a contract violation re-routes to. Every node declares an `error` output. */
const ERROR_PORT = 'error';

export class OutputContractApplier {
  private constructor() { /* static class */ }

  /**
   * Apply output-schema validation to a completed `RoutedBatchType`.
   *
   * When validator is null (validateOutputs is off), returns routed unchanged.
   * When validator is non-null, iterates every (port, item) pair; items whose
   * state fails the port's declared schema are re-routed to `'error'` and have a
   * `outputContractViolation` error collected on their state.
   */
  static applyToRouted<TState extends NodeStateInterface>(
    nodeName: string,
    outputSchema: Record<string, SchemaObjectType>,
    routed: RoutedBatchType<string, TState>,
    validator: OutputSchemaValidatorInterface | null,
  ): RoutedBatchType<string, TState> {
    if (validator === null) {
      return routed;
    }

    const acc = new Map<string, Array<{ id: string; state: TState }>>();
    let anyViolation = false;

    for (const [port, batch] of routed.entries()) {
      const portSchema: SchemaObjectType | undefined = outputSchema[port];

      for (const item of batch) {
        if (portSchema !== undefined) {
          const violations = validator.validatePort(port, portSchema, item.state);
          if (violations !== null) {
            anyViolation = true;
            const violationList = violations.length > 0 ? violations : ['schema mismatch'];
            const contractError = NodeErrorBuilder.from(
              'outputContractViolation',
              `Node '${nodeName}' output '${port}' violates outputSchema: ${violationList.join('; ')}`,
              'OutputContractApplier.applyToRouted',
              false,
              new Date().toISOString(),
              { 'context': { 'nodeName': nodeName, 'port': port, 'violations': violationList } },
            );
            item.state.collectError(contractError);
            const errorBucket = acc.get(ERROR_PORT);
            if (errorBucket !== undefined) {
              errorBucket.push({ 'id': item.id, 'state': item.state });
            } else {
              acc.set(ERROR_PORT, [{ 'id': item.id, 'state': item.state }]);
            }
            continue;
          }
        }
        // No violation (or no schema for this port): keep in original port.
        const bucket = acc.get(port);
        if (bucket !== undefined) {
          bucket.push({ 'id': item.id, 'state': item.state });
        } else {
          acc.set(port, [{ 'id': item.id, 'state': item.state }]);
        }
      }
    }

    if (!anyViolation) {
      return routed;
    }

    const result = new Map<string, Batch<TState>>();
    for (const [port, items] of acc) {
      result.set(port, Batch.from(items));
    }
    return result;
  }
}
