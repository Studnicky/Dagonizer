/**
 * PluginLoader: type-safe dynamic import of plugin packages.
 *
 * `PluginLoader.load(specifier)` dynamically imports a module and validates
 * that its default export implements `PluginInterface` — no casts at the call
 * site. Throws a typed `DAGError` (code 'PLUGIN_INVALID') when the module
 * does not export a valid plugin.
 */

import type { PluginInterface } from '../contracts/PluginInterface.js';
import { DAGError } from '../errors/DAGError.js';

/**
 * Type-safe dynamic plugin import with structural validation.
 *
 * Validates an imported module's default export against the `PluginInterface`
 * structural contract — no casts, no `as PluginInterface`. The only public
 * boundary is `PluginLoader.load(specifier)`.
 *
 * JSON Schema cannot validate "has a method named register that is a function"
 * (methods are not JSON-expressible), so structural predicate validation is the
 * correct and only approach here.
 */
export class PluginLoader {
  private constructor() { /* static-only */ }

  /**
   * Dynamically import a plugin module and validate its default export.
   *
   * @param specifier - Module specifier passed to `import()` (npm package name,
   *   relative path, URL). Accepts only string literals or operator-controlled
   *   values — never pass user input here.
   * @returns The validated `PluginInterface` default export.
   * @throws DAGError with code 'PLUGIN_INVALID' when the module does not
   *   export a valid plugin.
   */
  static async load(specifier: string): Promise<PluginInterface> {
    const mod: unknown = await import(specifier);
    return PluginLoader.#validate(mod, specifier);
  }

  static #isPlugin(value: unknown): value is PluginInterface {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value['id'] === 'string' &&
      value['id'].length > 0 &&
      'register' in value &&
      typeof value['register'] === 'function'
    );
  }

  static #validate(mod: unknown, specifier: string): PluginInterface {
    const candidate = PluginLoader.#extractDefault(mod);
    if (!PluginLoader.#isPlugin(candidate)) {
      throw new DAGError(
        `Plugin module '${specifier}' does not export a valid PluginInterface: ` +
        `default export must be an object with an id and register(dispatcher) method`,
        { "code": 'PLUGIN_INVALID' },
      );
    }
    return candidate;
  }

  static #extractDefault(mod: unknown): unknown {
    if (typeof mod === 'object' && mod !== null && 'default' in mod) {
      return mod['default'];
    }
    return mod;
  }
}
