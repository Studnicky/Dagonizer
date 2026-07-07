import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { PluginInterface, PluginReceiverType } from '../contracts/PluginInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type DagonizerPluginDefinitionType<TExports extends Record<string, string>> = {
  readonly id: string;
  readonly context?: Record<string, unknown>;
  readonly nodes: readonly NodeInterface<NodeStateInterface, string>[];
  readonly dags: readonly DAGType[];
  /** Child-state factories keyed by expanded DAG IRI. */
  readonly stateFactories?: Record<string, ChildStateFactoryType>;
  readonly exports: TExports;
};

export type DefinedDagonizerPluginType<TExports extends Record<string, string>> =
  PluginInterface & {
    readonly id: string;
    readonly context: Record<string, unknown>;
    readonly bundle: DispatcherBundleType<NodeStateInterface>;
    readonly exports: Readonly<TExports>;
  };

function validateExports(exports: Record<string, string>, dags: readonly DAGType[]): void {
  const dagNames = new Set(dags.map((dag) => dag.name));
  for (const [exportName, dagName] of Object.entries(exports)) {
    if (!dagNames.has(dagName)) {
      throw new DAGError(
        `Plugin export '${exportName}' references unknown DAG '${dagName}'`,
        { 'code': 'PLUGIN_INVALID' },
      );
    }
  }
}

class DagonizerPlugin {
  private constructor() { /* static-only */ }

  static bundle<TExports extends Record<string, string>>(
    definition: DagonizerPluginDefinitionType<TExports>,
  ): DispatcherBundleType<NodeStateInterface> {
    return {
      'specifier': definition.id,
      'nodes': [...definition.nodes],
      'dags': [...definition.dags],
      ...(definition.stateFactories !== undefined ? { 'stateFactories': { ...definition.stateFactories } } : {}),
      ...(definition.context !== undefined ? { 'context': { ...definition.context } } : {}),
    };
  }

  static define<TExports extends Record<string, string>>(
    definition: DagonizerPluginDefinitionType<TExports>,
  ): DefinedDagonizerPluginType<TExports> {
    validateExports(definition.exports, definition.dags);

    const bundle = DagonizerPlugin.bundle(definition);
    const exports: TExports = { ...definition.exports };
    const context = { ...(definition.context ?? {}) };

    return {
      'id': definition.id,
      context,
      bundle,
      exports,
      register(dispatcher: PluginReceiverType): void {
        dispatcher.registerBundle(bundle);
      },
    };
  }
}

export const defineDagonizerPlugin = DagonizerPlugin.define;
