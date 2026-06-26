/**
 * PluginSpecifier: static helpers for resolving a DAG name to an import() specifier.
 *
 * Two canonical resolvers ship with the engine:
 * - `PluginSpecifier.bareName` — Node.js default. Returns the bare npm package name unchanged.
 *   Pass directly as `resolveSpecifier`: `PluginDiscovery.loadAll(dag, registry, dispatcher, PluginSpecifier.bareName)`.
 * - `PluginSpecifier.rootedAt(baseUrl)` — Browser resolver. Returns a URL relative to `baseUrl`
 *   for bare names; passes through names that are already absolute URLs unchanged.
 *   Typical usage: `PluginSpecifier.rootedAt(import.meta.url)` or a CDN base URL.
 *
 * In-browser specifiers must be fully-qualified ESM URLs — bare npm package names
 * are not resolvable in a browser `import()` without a resolver.
 */

export class PluginSpecifier {
  private constructor() { /* static-only */ }

  /**
   * Node.js default resolver: returns the bare package name unchanged.
   *
   * Node resolves bare npm package names from `node_modules`. Pass this directly
   * as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`.
   *
   * @example
   * ```ts
   * await PluginDiscovery.loadAll(dag, registry, dispatcher, PluginSpecifier.bareName);
   * ```
   */
  static bareName(name: string): string {
    return name;
  }

  /**
   * Browser resolver factory: returns a resolver that maps bare names to absolute
   * ESM URLs under `baseUrl`.
   *
   * If `name` is already an absolute URL (parseable as a standalone URL), it is
   * returned unchanged. Otherwise returns `new URL('./${name}.js', baseUrl).href`.
   *
   * Typical usage: `PluginSpecifier.rootedAt(import.meta.url)` roots specifiers at the
   * calling module's location, or pass a CDN base such as `'https://cdn.example.com/plugins/'`.
   *
   * In-browser specifiers must be fully-qualified ESM URLs — bare npm package names
   * are not resolvable in a browser `import()` without an import map.
   *
   * @param baseUrl - Base URL used to resolve relative plugin names.
   * @returns A `(name: string) => string` resolver for use with `PluginDiscovery.loadAll`.
   */
  static rootedAt(baseUrl: string): (name: string) => string {
    return (name: string): string => {
      // If name is already absolute, pass through unchanged.
      try {
        new URL(name);
        return name;
      } catch {
        return new URL(`./${name}.js`, baseUrl).href;
      }
    };
  }
}
