/**
 * noocodec ESLint rules — canonical, project-portable extension.
 *
 * This file is the single source of truth for the @noocodec custom lint rules
 * and is copied verbatim between @noocodec projects (canonical home: noocodec-bot).
 * It is self-contained: it imports only Node built-ins so it can be dropped into
 * any flat-config project and registered as the `noocodec` plugin.
 *
 * Rules:
 * - `noocodec/filename-matches-export`   — a file's name must match one of its
 *   named exports (the canonical-location discipline). Skips index/types files,
 *   test/spec/stories, and the types/errors/constants suffix-convention dirs;
 *   interfaces/ IS enforced.
 * - `noocodec/interface-must-be-contract` — an `interface` must carry at least
 *   one method/call/construct signature. Method-less data shapes belong in
 *   `src/types/` as `type`. A small allowlist covers declaration-merge points.
 * - `noocodec/type-alias-must-end-type`  — every EXPORTED `type` alias must end
 *   in `Type`. No allowlist, no exceptions (external re-exports are not alias
 *   declarations and are therefore out of scope).
 *
 * Usage (flat config):
 *   import noocodec from './eslint-rules/noocodec.mjs';
 *   // plugins: { noocodec }
 *   // rules: { 'noocodec/interface-must-be-contract': 'error', ... }
 */

import {
  basename, extname
} from 'node:path';

const filenameMatchesExport = {
  create(context) {
    const options = context.options[0] ?? {};
    const isStrict = options.casing === 'strict';
    const stripExtra = options.stripextra === true;

    return {
      Program(node) {
        const filename = context.filename;
        const filenameSansExt = basename(filename, extname(filename));

        if ([
          'index',
          'types'
        ].includes(filenameSansExt) || /\.(test|spec|stories)$/.test(filenameSansExt)) {
          return;
        }
        // interfaces/ IS enforced (filename must match the exported *Interface symbol);
        // types/errors/constants are exempt (multi-export / suffix-convention files).
        if (/[/\\](types|errors|constants)[/\\]/.test(filename)) {
          return;
        }
        if (node.body.some((item) => {
          return item.type === 'ExportDefaultDeclaration';
        })) {
          return;
        }
        const namedExports = node.body.filter((item) => {
          return item.type === 'ExportNamedDeclaration';
        });

        if (namedExports.length === 0) {
          return;
        }
        const exportNames = namedExports.flatMap((exp) => {
          if (exp.declaration) {
            if ('declarations' in exp.declaration && exp.declaration.declarations) {
              return exp.declaration.declarations.map((decl) => {
                return decl.id?.name ?? '';
              });
            }

            return [exp.declaration.id?.name ?? ''];
          }
          if (exp.specifiers) {
            return exp.specifiers.map((spec) => {
              return 'name' in spec.exported ? spec.exported.name : spec.exported.value;
            });
          }

          return [];
        });
        const normalize = (name) => {
          let result = name;

          if (stripExtra) {
            result = result.replace(/[^a-zA-Z0-9]/g, '');
          }
          if (!isStrict) {
            result = result.toLowerCase();
          }

          return result;
        };

        if (!exportNames.some((name) => {
          return normalize(name) === normalize(filenameSansExt);
        })) {
          context.report({
            'messageId': 'noMatchingExport',
            node
          });
        }
      }
    };
  },
  'meta': {
    'docs': { 'description': 'Enforce filename matches a named export' },
    'messages': { 'noMatchingExport': 'Filename does not match any named exports' },
    'schema': [{
      'properties': {
        'casing': {
          'enum': [
            'strict',
            'loose'
          ],
          'type': 'string'
        },
        'stripextra': { 'type': 'boolean' }
      },
      'type': 'object'
    }],
    'type': 'suggestion'
  }
};

const interfaceMustBeContract = {
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);

    return {
      TSInterfaceDeclaration(node) {
        if (allow.has(node.id.name)) {
          return;
        }

        // NOTE: TSPropertySignature with a TSFunctionType typeAnnotation is a
        // function-valued FIELD (data), NOT behavioral. Do NOT count it.
        const hasBehavioralMember = node.body.body.some((member) => {
          return member.type === 'TSMethodSignature'
            || member.type === 'TSCallSignatureDeclaration'
            || member.type === 'TSConstructSignatureDeclaration';
        });

        if (!hasBehavioralMember) {
          context.report({
            'data': { 'name': node.id.name },
            'messageId': 'dataShapeMustBeType',
            'node': node.id
          });
        }
      }
    };
  },
  'meta': {
    'messages': {
      'dataShapeMustBeType':
        "Interface '{{name}}' has no method/call/construct signatures. Per the type-substrate rule, data shapes must be declared as `type` in src/types/; `interface` is reserved for behavioral/class contracts and the allowlisted augmentation points."
    },
    'schema': [{
      'properties': {
        'allow': {
          'items': { 'type': 'string' },
          'type': 'array'
        }
      },
      'type': 'object'
    }],
    'type': 'problem'
  }
};

const typeAliasMustEndType = {
  create(context) {
    return {
      TSTypeAliasDeclaration(node) {
        if (node.parent.type !== 'ExportNamedDeclaration') {
          return;
        }
        if (!node.id.name.endsWith('Type')) {
          context.report({
            'data': { 'name': node.id.name },
            'messageId': 'mustEndType',
            'node': node.id
          });
        }
      }
    };
  },
  'meta': {
    'messages': {
      'mustEndType':
        "Exported type alias '{{name}}' must end in 'Type'. The src/types/ substrate has no suffix exceptions — rename to '{{name}}Type'."
    },
    'schema': [],
    'type': 'problem'
  }
};

const interfaceMustEndInterface = {
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);

    return {
      TSInterfaceDeclaration(node) {
        if (allow.has(node.id.name)) {
          return;
        }
        if (!node.id.name.endsWith('Interface')) {
          context.report({
            'data': { 'name': node.id.name },
            'messageId': 'mustEndInterface',
            'node': node.id
          });
        }
      }
    };
  },
  'meta': {
    'messages': {
      'mustEndInterface':
        "Interface '{{name}}' must end in 'Interface'. Interfaces are contracts; the suffix keeps a contract distinct from a runtime/value import at the call site — rename to '{{name}}Interface'."
    },
    'schema': [{
      'properties': {
        'allow': {
          'items': { 'type': 'string' },
          'type': 'array'
        }
      },
      'type': 'object'
    }],
    'type': 'problem'
  }
};

/** The @noocodec ESLint plugin — register under the `noocodec` namespace. */
export const noocodec = {
  'meta': { 'name': 'noocodec' },
  'rules': {
    'filename-matches-export': filenameMatchesExport,
    'interface-must-be-contract': interfaceMustBeContract,
    'interface-must-end-interface': interfaceMustEndInterface,
    'type-alias-must-end-type': typeAliasMustEndType
  }
};
