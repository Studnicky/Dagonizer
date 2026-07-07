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
 * structural contract — no casts, no `as PluginInterface`. The boundary is
 * `PluginLoader.isPlugin()`: a structural type-guard predicate over the id
 * and register method every plugin must expose.
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

  /**
   * Validate an already-imported module object as a PluginInterface.
   *
   * Use when you have the module reference and want validation without
   * re-importing. Accepts either a module namespace object (with a `default`
   * export) or the plugin object itself.
   *
   * @param mod - Module namespace object or candidate plugin value.
   * @param specifier - Source identifier for error messages (default '<unknown>').
   * @returns The validated `PluginInterface`.
   * @throws DAGError with code 'PLUGIN_INVALID' when the value is not a valid plugin.
   */
  static validate(mod: unknown, specifier = '<unknown>'): PluginInterface {
    return PluginLoader.#validate(mod, specifier);
  }

  /**
   * Type-guard: narrows unknown → PluginInterface via structural check.
   *
   * Checks that `value` is a non-null object with an `id` string and a
   * `register` method.
   * This is the schema-validation boundary for the plugin contract — no JSON
   * Schema can express "has a callable method", so a structural predicate is
   * the correct approach.
   */
  static isPlugin(value: unknown): value is PluginInterface {
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
    if (!PluginLoader.isPlugin(candidate)) {
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
