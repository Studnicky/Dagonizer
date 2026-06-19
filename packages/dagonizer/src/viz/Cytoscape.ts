/**
 * Cytoscape: domain module that constructs a `cytoscape.Core` from a fully
 * resolved options object.
 *
 * ## Why a domain module, not a constructor injection
 *
 * The package never imports `cytoscape` as a value at module load — `cytoscape`
 * is an optional peer dependency, and importing it eagerly would break
 * runtime-neutral contexts (SSR, tests, builds without a DOM). `Cytoscape.create`
 * resolves the real factory lazily via a dynamic `import('cytoscape')` the first
 * time a graph is mounted, then constructs the `Core`.
 *
 * The single static method is the contract: `Cytoscape.create(options)`. There
 * is no instance, no injected factory, and no behavior seam — subclasses of
 * `CytoscapeGraph` customise the *options* via protected hooks, not the factory.
 */

import type cytoscape from 'cytoscape';

/**
 * Static domain module for constructing a `cytoscape.Core`.
 *
 * `Cytoscape.create` dynamic-imports `cytoscape` so this package stays
 * runtime-neutral; the optional peer is loaded only when a graph mounts.
 */
export class Cytoscape {
  /**
   * Construct a `cytoscape.Core` from a fully resolved options object.
   *
   * Lazily resolves the `cytoscape` factory via `import('cytoscape')` and
   * invokes it with `options`. Throws the dynamic-import error if the optional
   * `cytoscape` peer is not installed.
   *
   * @param options The complete `cytoscape.CytoscapeOptions` (container,
   *   elements, style, layout, interaction defaults).
   * @returns The constructed `cytoscape.Core`.
   */
  static async create(options: cytoscape.CytoscapeOptions): Promise<cytoscape.Core> {
    const module = await import('cytoscape');
    return module.default(options);
  }
}
