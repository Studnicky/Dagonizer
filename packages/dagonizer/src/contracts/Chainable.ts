import type { NodeInterface } from './NodeInterface.js';
import type { OperationContractFragment } from './OperationContractFragment.js';

/**
 * Chainable<A, B>: compile-time proof that B's hardRequired set is
 * satisfied by A's produces set. Resolves to `true` when chainable,
 * `never` otherwise. Use in test helpers and contract authoring to
 * surface drift at the type layer.
 *
 * Most useful when nodes are typed with `as const` literal-tuple contracts:
 *
 * ```ts
 * const fetchNode = {
 *   name: 'fetch',
 *   outputs: ['success'] as const,
 *   contract: { hardRequired: ['url'] as const, produces: ['raw'] as const },
 *   async execute(state, ctx) { return { output: 'success' }; },
 * } satisfies NodeInterface;
 *
 * const parseNode = {
 *   name: 'parse',
 *   outputs: ['success'] as const,
 *   contract: { hardRequired: ['raw'] as const, produces: ['record'] as const },
 *   async execute(state, ctx) { return { output: 'success' }; },
 * } satisfies NodeInterface;
 *
 * type Check = Chainable<typeof fetchNode, typeof parseNode>; // true
 * ```
 */
export type Chainable<
  A extends NodeInterface & { readonly contract: OperationContractFragment },
  B extends NodeInterface & { readonly contract: OperationContractFragment },
> = B['contract']['hardRequired'][number] extends A['contract']['produces'][number]
  ? true
  : never;
