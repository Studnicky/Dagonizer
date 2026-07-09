/**
 * PluginSpecifier: static helpers for resolving a DAG IRI to an import() specifier.
 *
 * Three canonical resolvers ship with the engine:
 * - `PluginSpecifier.bareName` — Node.js default. Returns the bare npm package name unchanged.
 *   Pass directly as `resolveSpecifier`: `PluginDiscovery.loadAll(dag, registry, dispatcher, PluginSpecifier.bareName)`.
 * - `PluginSpecifier.rootedAt(baseUrl)` — Browser resolver. Returns a URL relative to `baseUrl`
 *   for bare package specifiers; passes through names that are already absolute URLs unchanged.
 *   Typical usage: `PluginSpecifier.rootedAt(import.meta.url)` or a CDN base URL.
 * - `PluginSpecifier.byPrefix(source)` — Registry resolver. Resolves compact
 *   `prefix:dag` names through the plugin specifier registered for `prefix` and
 *   expanded DAG IRIs through the longest registered namespace IRI.
 * - `PluginSpecifier.byIriPrefix(source)` — Graph resolver. Resolves expanded
 *   DAG IRIs through their namespace IRI.
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
   * Browser resolver factory: returns a resolver that maps bare package specifiers
   * to absolute ESM URLs under `baseUrl`.
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

  /**
   * Registry resolver factory: maps a compact `prefix:local` DAG reference or
   * expanded DAG IRI to the plugin package/specifier that registered ownership
   * of the prefix namespace.
   */
  static byPrefix(
    source: {
      pluginSpecifierForPrefix(prefix: string): string | undefined;
      pluginPrefixSpecifiers?(): ReadonlyMap<string, string>;
    },
  ): (name: string) => string | undefined {
    return (name: string): string | undefined => {
      const colonIdx = name.indexOf(':');
      if (colonIdx > 0 && name.charAt(colonIdx + 1) !== '/') {
        return source.pluginSpecifierForPrefix(name.substring(0, colonIdx));
      }
      let bestNamespace = '';
      let bestSpecifier: string | undefined;
      for (const [namespaceIri, specifier] of source.pluginPrefixSpecifiers?.() ?? []) {
        if (!namespaceIri.includes('://') || !name.startsWith(namespaceIri)) continue;
        if (namespaceIri.length <= bestNamespace.length) continue;
        bestNamespace = namespaceIri;
        bestSpecifier = specifier;
      }
      return bestSpecifier;
    };
  }

  /**
   * Graph resolver factory: maps expanded DAG IRIs from `PluginDiscovery.walk()`
   * to the plugin package/specifier registered for the owning namespace IRI.
   */
  static byIriPrefix(
    source: { pluginSpecifierForNamespace(namespaceIri: string): string | undefined },
  ): (dagIri: string) => string | undefined {
    return (dagIri: string): string | undefined => {
      const namespaceIri = PluginSpecifier.namespaceOf(dagIri);
      return namespaceIri === null ? undefined : source.pluginSpecifierForNamespace(namespaceIri);
    };
  }

  private static namespaceOf(dagIri: string): string | null {
    const hashIndex = dagIri.lastIndexOf('#');
    if (hashIndex >= 0) return dagIri.slice(0, hashIndex + 1);

    try {
      const parsed = new URL(dagIri);
      const slashIndex = parsed.href.lastIndexOf('/');
      return slashIndex >= 0 ? parsed.href.slice(0, slashIndex + 1) : null;
    } catch {
      return null;
    }
  }
}
