import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * Inline canonical-naming plugin (§2.1). No new npm dependency: these rules
 * are defined in-config and ride the existing per-package flat configs.
 *
 *   no-type-value-collision — a module must not export `type X` and `const X`
 *     under one identifier. The value takes a distinct plural name; the type
 *     keeps the singular. Detected by collecting exported type-alias /
 *     interface names and exported const names per file, then reporting any
 *     identifier that appears in both sets.
 */
const canonicalNamingPlugin = {
  rules: {
    'no-type-value-collision': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow exporting a type and a value (const) under the same identifier in one module.',
        },
        messages: {
          collision:
            "'{{name}}' is exported as both a type and a value. Give the value a distinct name (e.g. a plural) so the type and value never share one identifier.",
        },
        schema: [],
      },
      create(context) {
        /** @type {Map<string, import('estree').Node>} exported type/interface names */
        const typeNames = new Map();
        /** @type {Map<string, import('estree').Node>} exported const value names */
        const valueNames = new Map();

        const recordType = (node, name) => {
          if (typeof name === 'string') typeNames.set(name, node);
        };
        const recordValue = (node, name) => {
          if (typeof name === 'string') valueNames.set(name, node);
        };

        return {
          // `export type X = …` and `export interface X {}`
          'ExportNamedDeclaration > TSTypeAliasDeclaration': (node) => {
            recordType(node, node.id?.name);
          },
          'ExportNamedDeclaration > TSInterfaceDeclaration': (node) => {
            recordType(node, node.id?.name);
          },
          // `export const X = …` (value-position const, not `export type`)
          'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator': (node) => {
            if (node.id?.type === 'Identifier') recordValue(node, node.id.name);
          },
          // `export { X }` / `export type { X }` specifiers
          'ExportNamedDeclaration > ExportSpecifier': (node) => {
            if (node.exported?.type !== 'Identifier') return;
            const parent = node.parent;
            if (parent?.exportKind === 'type') {
              recordType(node, node.exported.name);
            } else if (node.exportKind === 'type') {
              recordType(node, node.exported.name);
            } else {
              // A non-type export specifier carries the value binding; the type
              // half (if any) is exported via a separate `export type { … }`.
              recordValue(node, node.exported.name);
            }
          },
          'Program:exit': () => {
            for (const [name, node] of typeNames) {
              if (valueNames.has(name)) {
                context.report({ node, messageId: 'collision', data: { name } });
              }
            }
          },
        };
      },
    },
  },
};

/**
 * Shared ESLint flat config factory for all @studnicky/dagonizer-* packages.
 *
 * @param {string} tsconfigRootDir - Absolute path to the package directory (pass `import.meta.dirname`).
 * @param {{ project?: string, files?: string[] }} [options]
 */
export function dagonizerEslintConfig(tsconfigRootDir, options = {}) {
  const project = options.project ?? './tsconfig.eslint.json';
  const files = options.files ?? ['src/**/*.ts', 'tests/**/*.ts'];

  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/dist-test/**',
        '**/node_modules/**',
        '**/build/**',
        '**/*.d.ts',
        'docs/.vitepress/cache/**',
      ],
    },
    {
      files,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          project,
          tsconfigRootDir,
        },
        globals: {
          // Node.js
          'Buffer': 'readonly',
          'NodeJS': 'readonly',
          'process': 'readonly',
          'setImmediate': 'readonly',
          'clearImmediate': 'readonly',
          '__dirname': 'readonly',
          '__filename': 'readonly',
          'module': 'readonly',
          'require': 'readonly',
          'exports': 'readonly',
          // Timers (shared Node/browser)
          'setTimeout': 'readonly',
          'clearTimeout': 'readonly',
          'setInterval': 'readonly',
          'clearInterval': 'readonly',
          // Console
          'console': 'readonly',
          // Web / Worker globals
          'globalThis': 'readonly',
          'self': 'readonly',
          'navigator': 'readonly',
          'WebAssembly': 'readonly',
          'Worker': 'readonly',
          'MessagePort': 'readonly',
          'MessageChannel': 'readonly',
          'MessageEvent': 'readonly',
          'postMessage': 'readonly',
          'crypto': 'readonly',
          'caches': 'readonly',
          'TextEncoder': 'readonly',
          'TextDecoder': 'readonly',
          'performance': 'readonly',
          'queueMicrotask': 'readonly',
          'Blob': 'readonly',
          'ReadableStream': 'readonly',
          'WritableStream': 'readonly',
          // Fetch API
          'fetch': 'readonly',
          'Response': 'readonly',
          'Request': 'readonly',
          'Headers': 'readonly',
          'RequestInit': 'readonly',
          // URL
          'URL': 'readonly',
          'URLSearchParams': 'readonly',
          // Abort
          'AbortController': 'readonly',
          'AbortSignal': 'readonly',
          // DOM exceptions + structured clone
          'DOMException': 'readonly',
          'structuredClone': 'readonly',
          // Storage
          'localStorage': 'readonly',
        },
      },
      plugins: {
        '@typescript-eslint': tseslint.plugin,
        'import-x': importPlugin,
        'canonical-naming': canonicalNamingPlugin,
      },
      rules: {
        ...js.configs.recommended.rules,
        ...tseslint.configs.recommended.rules,
        ...tseslint.configs.recommendedTypeChecked.rules,

        'no-unused-vars': 'off',

        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            'argsIgnorePattern': '^_',
            'varsIgnorePattern': '^_',
            'caughtErrorsIgnorePattern': '^_',
          },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            'prefer': 'type-imports',
            'fixStyle': 'separate-type-imports',
          },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-non-null-assertion': 'warn',

        'quote-props': ['error', 'always'],
        'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
        'no-console': 'warn',
        'no-debugger': 'error',
        'no-redeclare': 'off',

        '@typescript-eslint/no-empty-interface': 'warn',
        '@typescript-eslint/ban-ts-comment': [
          'warn',
          {
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': 'allow-with-description',
            'ts-nocheck': false,
            'ts-check': false,
          },
        ],

        'import-x/order': [
          'error',
          {
            'groups': ['builtin', 'external', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
            'alphabetize': { 'order': 'asc', 'caseInsensitive': true },
          },
        ],
        'import-x/no-duplicates': 'error',
      },
    },
    // Framework-purity gate: package runtime (`src/**`) emits nothing. No
    // `console.*`, no direct `process.stdout`/`process.stderr` writes. Logging
    // and observability are the consumer's job; the framework throws on
    // conditions it cannot continue past. `examples/**`, `tests/**`, and
    // `testing/**` are exempt — they are not the framework runtime. The single
    // sanctioned exception (the stdin/stdout transport in
    // `dagonizer-executor-node/src/spawnEntry.ts`) is re-allowed in that
    // package's own flat config.
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-console': 'error',
        'no-restricted-properties': [
          'error',
          {
            'object': 'process',
            'property': 'stdout',
            'message': 'Framework runtime must not write to process.stdout; logging is the consumer\'s job (subclass Dagonizer and emit from lifecycle hooks).',
          },
          {
            'object': 'process',
            'property': 'stderr',
            'message': 'Framework runtime must not write to process.stderr; logging is the consumer\'s job (subclass Dagonizer and emit from lifecycle hooks).',
          },
        ],
      },
    },
    // §2.1 Canonical naming gate: framework runtime (`src/**`). One symbol, one
    // name; no underscore-prefixed declarations; no freestanding exported
    // functions. `tests/**`, `testing/**`, and `examples/**` are exempt — the
    // `^_` unused-binding marker (for-await discards, type-assertion scaffolds)
    // is the sanctioned convention there and is honoured by
    // @typescript-eslint/no-unused-vars.
    {
      files: ['src/**/*.ts'],
      rules: {
        // Type+value collision: a module must not export `type X` and `const X`
        // under one identifier (inline plugin defined above).
        'canonical-naming/no-type-value-collision': 'error',

        'no-restricted-syntax': [
          'error',
          // Leading-underscore identifiers on DECLARATIONS (camelCase for
          // values/methods, PascalCase for types/classes, `#` for privates).
          // PARAMETERS are intentionally not matched: `^_` is the sanctioned
          // unused-argument marker.
          {
            'selector': 'TSTypeAliasDeclaration[id.name=/^_/]',
            'message': 'No leading-underscore identifiers. Use a canonical PascalCase type name.',
          },
          {
            'selector': 'TSInterfaceDeclaration[id.name=/^_/]',
            'message': 'No leading-underscore identifiers. Use a canonical PascalCase interface name.',
          },
          {
            'selector': 'ClassDeclaration[id.name=/^_/]',
            'message': 'No leading-underscore identifiers. Use a canonical PascalCase class name.',
          },
          {
            'selector': 'FunctionDeclaration[id.name=/^_/]',
            'message': 'No leading-underscore identifiers. Use a canonical camelCase function name.',
          },
          {
            'selector': 'VariableDeclarator[id.type="Identifier"][id.name=/^_/]',
            'message': 'No leading-underscore identifiers. Use a canonical camelCase name, or `#` for private class members.',
          },
          // Freestanding exported functions: every public operation is a
          // `noun.verb()` static method on a domain class. No module-level
          // `export function` / `export const … = (…) =>`.
          {
            'selector': 'ExportNamedDeclaration > FunctionDeclaration',
            'message': 'No freestanding exported functions. Make it a static `noun.verb()` method on a domain class.',
          },
          {
            'selector': 'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"]',
            'message': 'No freestanding exported functions. Make it a static `noun.verb()` method on a domain class.',
          },
          {
            'selector': 'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type="FunctionExpression"]',
            'message': 'No freestanding exported functions. Make it a static `noun.verb()` method on a domain class.',
          },
          // Domain-class verb gate (§ noun.verb()): no make/build/from/parse/create-prefixed
          // method, function, or static-factory names. The registered name is the contract.
          // Bare `from` (no uppercase suffix) stays allowed — it is the canonical materializer.
          {
            'selector': 'MethodDefinition[key.name=/^(make|build|from|parse|create)[A-Z]/]',
            'message': 'No make/build/from/parse/create-prefixed method names. Use an idiomatic noun.verb() (e.g. compose/of/decode/render/spawn). Bare `from` is allowed.',
          },
          {
            'selector': 'PropertyDefinition[key.name=/^(make|build|from|parse|create)[A-Z]/]',
            'message': 'No make/build/from/parse/create-prefixed member names. Use an idiomatic noun.verb().',
          },
          {
            'selector': 'FunctionDeclaration[id.name=/^(make|build|from|parse|create)[A-Z]/]',
            'message': 'No make/build/from/parse/create-prefixed function names. Use an idiomatic noun.verb().',
          },
          {
            'selector': 'TSMethodSignature[key.name=/^(make|build|from|parse|create)[A-Z]/]',
            'message': 'No make/build/from/parse/create-prefixed interface method names. Use an idiomatic noun.verb().',
          },
          {
            'selector': 'TSPropertySignature[key.name=/^(make|build|from|parse|create)[A-Z]/]',
            'message': 'No make/build/from/parse/create-prefixed interface member names. Use an idiomatic noun.verb().',
          },
        ],
      },
    },
  );
}
