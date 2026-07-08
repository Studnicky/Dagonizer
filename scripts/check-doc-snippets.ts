/**
 * check-doc-snippets: type-check every `twoslash` fenced block in the docs.
 *
 * The docs site type-checks ```ts twoslash blocks at build time via the
 * VitePress twoslash transformer, but the vite build fails fast on the first
 * bad block. This script type-checks every twoslash block independently and
 * reports ALL failures in one pass, so doc snippets cannot drift from the
 * shipped package types. It is the fast local + CI guard behind the rule that
 * docs carry no untyped TypeScript.
 *
 * Compiler options mirror the transformerTwoslash config in
 * docs/.vitepress/config.ts so a block that passes here passes the build.
 *
 * Each block is emitted as its own module (an `export {}` is appended when the
 * block has no top-level import/export) so top-level declarations in different
 * blocks never collide and each block is validated in isolation.
 *
 * Blocks carrying a `// @errors:` or `// @noErrors` twoslash pragma declare
 * expected diagnostics and are skipped — the build owns those.
 *
 * Run: tsx scripts/check-doc-snippets.ts  (npm: pnpm run check:docs)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');

interface Snippet {
  readonly virtualPath: string;
  readonly mdFile:      string;
  readonly startLine:   number;
  readonly text:        string;
}

interface PolicyViolation {
  readonly mdFile:  string;
  readonly line:    number;
  readonly message: string;
}

const FENCE = /^```(ts|tsx|typescript)\b([^\n]*)$/;
const CODE_FENCE = /^```([a-zA-Z0-9_-]+)?\b([^\n]*)$/;
const DAG_REFERENCE_LANGUAGES = new Set(['json', 'jsonc', 'ts', 'tsx', 'typescript']);
const NUMBERED_EXAMPLE_PATH = /^docs\/examples\/\d\d[a-z0-9-]*\.md$/u;

// twoslash blocks carrying `// @errors:`/`// @noErrors` declare expected
// diagnostics and are not type-checked here; collected and reported so a
// suppressed block can never hide silently.
const skipped: string[] = [];

class MarkdownSnippets {
  private constructor() {}

  static list(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === 'cache') continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...MarkdownSnippets.list(full));
      else if (name.endsWith('.md')) out.push(full);
    }
    return out;
  }

  static extract(mdFile: string): Snippet[] {
    const lines = readFileSync(mdFile, 'utf8').split('\n');
    const snippets: Snippet[] = [];
    let i = 0;
    let blockIndex = 0;
    while (i < lines.length) {
      const open = FENCE.exec(lines[i] ?? '');
      if (!open) { i++; continue; }
      const meta = open[2] ?? '';
      const bodyStart = i + 1;
      let j = bodyStart;
      while (j < lines.length && (lines[j] ?? '').trim() !== '```') j++;
      const body = lines.slice(bodyStart, j).join('\n');
      i = j + 1;
      if (!/\btwoslash\b/.test(meta)) continue;          // only twoslash blocks
      if (/\/\/\s*@(errors|noErrors)\b/.test(body)) {     // expected-error blocks: not type-checked here
        skipped.push(`${relative(repoRoot, mdFile)}:${bodyStart + 1}`);
        continue;
      }
      const isModule = /^\s*(import|export)\b/m.test(body);
      const text = isModule ? body : `${body}\nexport {};\n`;
      snippets.push({
        virtualPath: join(docsRoot, `.snippet-check/${relative(docsRoot, mdFile).replace(/[/.]/g, '_')}__${blockIndex++}.ts`),
        mdFile,
        startLine: bodyStart + 1,
        text,
      });
    }
    return snippets;
  }
}

class MarkdownPolicy {
  private constructor() {}

  static check(mdFiles: readonly string[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    for (const mdFile of mdFiles) {
      const lines = readFileSync(mdFile, 'utf8').split('\n');
      violations.push(...MarkdownPolicy.checkLegacyDagFrom(mdFile, lines));
      violations.push(...MarkdownPolicy.checkDagReferenceSnippets(mdFile, lines));
      violations.push(...MarkdownPolicy.checkNumberedExampleStructure(mdFile, lines));
    }
    return violations;
  }

  private static checkLegacyDagFrom(mdFile: string, lines: readonly string[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.includes('dagFrom')) {
        violations.push({
          mdFile,
          'line': i + 1,
          'message': "docs must not mention legacy 'dagFrom'; use graph-addressable DagReference candidates",
        });
      }
    }
    return violations;
  }

  private static checkDagReferenceSnippets(mdFile: string, lines: readonly string[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    let i = 0;
    while (i < lines.length) {
      const open = CODE_FENCE.exec(lines[i] ?? '');
      if (!open) { i++; continue; }
      const language = open[1] ?? '';
      const bodyStart = i + 1;
      let j = bodyStart;
      while (j < lines.length && (lines[j] ?? '').trim() !== '```') j++;
      const body = lines.slice(bodyStart, j).join('\n');
      i = j + 1;

      if (!MarkdownPolicy.isDynamicDagReferenceSnippet(language, body)) continue;
      if (/\bcandidates\b/u.test(body)) continue;
      violations.push({
        mdFile,
        'line': bodyStart + 1,
        'message': 'dynamic DagReference docs snippets must declare explicit candidates',
      });
    }
    return violations;
  }

  private static isDynamicDagReferenceSnippet(language: string, body: string): boolean {
    if (!DAG_REFERENCE_LANGUAGES.has(language)) return false;
    if (!/(["']@type["']\s*:\s*["']DagReference["'])/u.test(body)) return false;
    return /\bfrom\b/u.test(body) && /\bpath\b/u.test(body);
  }

  private static checkNumberedExampleStructure(mdFile: string, lines: readonly string[]): PolicyViolation[] {
    const rel = relative(repoRoot, mdFile);
    if (!NUMBERED_EXAMPLE_PATH.test(rel)) return [];

    const body = lines.join('\n');
    const violations: PolicyViolation[] = [];
    if (!MarkdownPolicy.hasCodeSurface(body)) {
      violations.push({
        mdFile,
        'line': 1,
        'message': 'numbered example pages must show code from the runnable example or an executable snippet',
      });
    }
    if (!MarkdownPolicy.hasDiagramSurface(body)) {
      violations.push({
        mdFile,
        'line': 1,
        'message': 'numbered example pages must show the DAG diagram beside the code',
      });
    }
    return violations;
  }

  private static hasCodeSurface(body: string): boolean {
    return /<<< @\/\.\.\//u.test(body)
      || /```(?:ts|tsx|typescript|json)\b/u.test(body);
  }

  private static hasDiagramSurface(body: string): boolean {
    return /<DagJsonMermaid\b/u.test(body)
      || /```mermaid\b/u.test(body);
  }
}

const compilerOptions: ts.CompilerOptions = {
  target:                    ts.ScriptTarget.ES2022,
  module:                    ts.ModuleKind.ESNext,
  moduleResolution:          ts.ModuleResolutionKind.Bundler,
  lib:                       ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types:                     ['node'],
  strict:                    true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess:  true,
  skipLibCheck:              true,
  noEmit:                    true,
  allowJs:                   false,
};

// Optional path filters: `tsx scripts/check-doc-snippets.ts reference/store guide/retry`
// restricts the run to md files whose repo-relative path contains any argument.
// With no arguments, every doc is checked (the CI default).
const filters = process.argv.slice(2);
const mdFiles = MarkdownSnippets.list(docsRoot).filter(
  f => filters.length === 0 || filters.some(arg => relative(repoRoot, f).includes(arg)),
);
const snippets = mdFiles.flatMap(f => MarkdownSnippets.extract(f));
const policyViolations = MarkdownPolicy.check(mdFiles);

const byPath = new Map(snippets.map(s => [s.virtualPath, s]));
const host = ts.createCompilerHost(compilerOptions);
const baseReadFile = host.readFile.bind(host);
const baseFileExists = host.fileExists.bind(host);
host.readFile = (name) => byPath.get(name)?.text ?? baseReadFile(name);
host.fileExists = (name) => byPath.has(name) || baseFileExists(name);

const program = ts.createProgram([...byPath.keys()], compilerOptions, host);

let failed = 0;
const checked = snippets.length;
for (const snippet of snippets) {
  const sf = program.getSourceFile(snippet.virtualPath);
  if (!sf) continue;
  const diags = [
    ...program.getSemanticDiagnostics(sf),
    ...program.getSyntacticDiagnostics(sf),
  ];
  if (diags.length === 0) continue;
  failed++;
  const rel = relative(repoRoot, snippet.mdFile);
  process.stdout.write(`\n${rel} (block opening near line ${snippet.startLine}):\n`);
  for (const d of diags) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    let where = '';
    if (d.file && typeof d.start === 'number') {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      where = ` [snippet ${line + 1}:${character + 1}]`;
    }
    process.stdout.write(`  - TS${d.code}${where}: ${msg}\n`);
  }
}

if (skipped.length > 0) {
  process.stdout.write(`\ncheck-doc-snippets: ${skipped.length} block(s) skipped (// @errors/@noErrors — not type-checked):\n`);
  for (const s of skipped) process.stdout.write(`  - ${s}\n`);
}

if (policyViolations.length > 0) {
  process.stdout.write(`\ncheck-doc-snippets: ${policyViolations.length} docs policy violation(s):\n`);
  for (const violation of policyViolations) {
    process.stdout.write(`  - ${relative(repoRoot, violation.mdFile)}:${violation.line}: ${violation.message}\n`);
  }
}

if (failed > 0 || policyViolations.length > 0) {
  process.stdout.write(`\ncheck-doc-snippets: ${failed} of ${checked} twoslash block(s) failed type-checking; ${policyViolations.length} policy violation(s).\n`);
  process.exit(1);
}
process.stdout.write(`check-doc-snippets: all ${checked} twoslash block(s) type-check (${skipped.length} skipped); docs policy clean.\n`);
