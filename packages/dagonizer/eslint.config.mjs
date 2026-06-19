import { dagonizerEslintConfig } from '../../eslint.config.base.mjs';

/**
 * Onion-skin layering zones (§2.5). Imports point strictly inward:
 *
 *   contracts → entities → runtime+core → engine (Dagonizer/lifecycle/
 *   validation/builder/derive) → outer surfaces (adapter/container/viz/tool)
 *
 * No inner-layer module imports a more-outer one. Each zone below bans the
 * relative paths that reach up the onion. Entities are the shared data
 * vocabulary every inner layer speaks, so `contracts/` importing `entities/`
 * is an inward (allowed) edge and is NOT restricted.
 *
 * Patterns match the literal import specifier. `contracts/`, `core/`,
 * `runtime/`, and `tool/` are flat directories, so an outer module is always
 * reached via `../<dir>/…`. `entities/` nests one level (e.g.
 * `entities/execution/…`), and it also has its OWN `validation/` and
 * `adapter/` subdirectories; an outer module from a nested entity file is
 * therefore reached via `../../<dir>/…`, while a same-level sibling uses
 * `../<dir>/…`. The entities zone bans only the `../../`-and-deeper outer
 * reaches so sibling `../adapter`/`../validation` imports inside `entities/`
 * stay allowed.
 *
 * The single sanctioned exception (D1): `entities/**` may import
 * `NodeStateInterface` from the root `NodeStateBase` module — the three-tier
 * taxonomy homes that class-shape interface with its class. `NodeStateBase` is
 * simply absent from the ban list, so it remains allowed.
 */
export default [
  ...dagonizerEslintConfig(import.meta.dirname, {
    files: ['src/**/*.ts', 'testing/**/*.ts', 'tests/**/*.ts', 'examples/**/*.ts'],
  }),

  // contracts/ — the innermost layer (flat). Must not reach up into runtime,
  // core, adapter, validation, or the engine class.
  {
    files: ['src/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          'patterns': [
            {
              'group': [
                '../Dagonizer.js',
                '../validation/*',
                '../adapter/*',
                '../runtime/*',
                '../core/*',
              ],
              'message':
                'contracts/ is the innermost layer: it must not import runtime/, core/, adapter/, validation/, or the Dagonizer engine. Home the structural type in contracts/ or entities/ and import inward.',
            },
          ],
        },
      ],
    },
  },

  // entities/ — schemas + FromSchema types. Must not import the engine
  // (validation/adapter/Dagonizer) or runtime. Outer reaches from nested
  // entity files use `../../` (siblings use `../`). The lone D1 exception
  // (NodeStateBase) is absent from the ban list, so it stays allowed.
  {
    files: ['src/entities/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          'patterns': [
            {
              'group': [
                '../Dagonizer.js',
                '../../Dagonizer.js',
                '../../validation/*',
                '../../adapter/*',
                '../../runtime/*',
              ],
              'message':
                'entities/ holds only schemas and FromSchema types: it must not import validation/, adapter/, runtime/, or the Dagonizer engine. The sole sanctioned exception (D1) is NodeStateInterface from NodeStateBase.',
            },
          ],
        },
      ],
    },
  },

  // runtime/ and core/ — execution primitives (flat). Must not reach up into
  // the engine (Dagonizer/validation) or the adapter outer surface.
  {
    files: ['src/runtime/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          'patterns': [
            {
              'group': [
                '../Dagonizer.js',
                '../validation/*',
                '../adapter/*',
              ],
              'message':
                'runtime/ and core/ are below the engine: they must not import validation/, adapter/, or the Dagonizer engine.',
            },
          ],
        },
      ],
    },
  },

  // tool/ — must not depend on the adapter outer surface. Shared wire shapes
  // (e.g. ToolDefinition) live in entities/adapter/ and are imported inward.
  {
    files: ['src/tool/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          'patterns': [
            {
              'group': ['../adapter/*'],
              'message':
                'tool/ must not import the adapter outer surface. Import shared shapes from entities/adapter/ (canonical home).',
            },
          ],
        },
      ],
    },
  },
];
