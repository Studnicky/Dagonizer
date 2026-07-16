import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineCollection, z } from 'astro:content';
import { register } from 'tsx/esm/api';
import { renderDocDiagramEmbed } from './src/lib/doc-diagram-embed';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsRoot = resolve(repoRoot, 'docs');
const ignoredDirs = new Set(['.vitepress', '.orchestration', 'public']);
const docEmbedTempRoot = resolve(repoRoot, '.orchestration/doc-embed-modules');

register();
mkdirSync(docEmbedTempRoot, { recursive: true });

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];

  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) {
      continue;
    }

    if (ignoredDirs.has(name)) {
      continue;
    }

    const absolutePath = join(root, name);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...listMarkdownFiles(absolutePath));
      continue;
    }

    if (name.endsWith('.md')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function parseFrontmatter(source: string): { readonly data: Record<string, unknown>; readonly body: string } {
  if (!source.startsWith('---\n')) {
    return { data: {}, body: source };
  }

  const endIndex = source.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { data: {}, body: source };
  }

  const rawFrontmatter = source.slice(4, endIndex);
  const body = source.slice(endIndex + 5);
  const data: Record<string, unknown> = {};
  let activeKey: string | null = null;
  let activeList: Array<Record<string, string>> | null = null;
  let activeListItem: Record<string, string> | null = null;

  const commitListItem = (): void => {
    if (activeList !== null && activeListItem !== null) {
      activeList.push(activeListItem);
    }
    activeListItem = null;
  };

  for (const rawLine of rawFrontmatter.split('\n')) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const listKeyMatch = /^([A-Za-z0-9_-]+):\s*$/.exec(trimmed);
    if (listKeyMatch) {
      commitListItem();
      activeKey = listKeyMatch[1];
      activeList = [];
      data[activeKey] = activeList;
      continue;
    }

    const scalarMatch = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(trimmed);
    if (scalarMatch && !line.startsWith('  ')) {
      commitListItem();
      activeKey = null;
      activeList = null;
      data[scalarMatch[1]] = scalarMatch[2].replace(/^['"]|['"]$/g, '').trim();
      continue;
    }

    if (activeList !== null) {
      const itemStartMatch = /^-\s+([A-Za-z0-9_-]+):\s*(.+)$/.exec(trimmed);
      if (itemStartMatch) {
        commitListItem();
        activeListItem = {
          [itemStartMatch[1]]: itemStartMatch[2].replace(/^['"]|['"]$/g, '').trim()
        };
        continue;
      }

      const itemFieldMatch = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(trimmed);
      if (itemFieldMatch && activeListItem !== null) {
        activeListItem[itemFieldMatch[1]] = itemFieldMatch[2].replace(/^['"]|['"]$/g, '').trim();
      }
    }
  }

  commitListItem();
  return { data, body };
}

function stripScriptSetupBlocks(body: string): string {
  return body.replace(/<script setup[\s\S]*?<\/script>\s*/g, '');
}

function extractScriptSetup(body: string): string | undefined {
  const match = /<script setup(?:\s+lang="ts")?\s*>([\s\S]*?)<\/script>/.exec(body);
  return match?.[1]?.trim();
}

function languageForPath(filePath: string): string {
  return ({
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.jsx': 'jsx',
    '.json': 'json',
    '.jsonld': 'json',
    '.vue': 'vue',
    '.mjs': 'js',
    '.cjs': 'js',
    '.sh': 'bash',
    '.md': 'md'
  } as Record<string, string>)[extname(filePath)] ?? '';
}

function resolveSnippetPath(markdownFilePath: string, target: string): string {
  if (target.startsWith('@/')) {
    return resolve(docsRoot, target.slice(2));
  }

  return resolve(markdownFilePath, '..', target);
}

function rewriteScriptImportSpecifiers(script: string, markdownFilePath: string): string {
  const rewrite = (_full: string, prefix: string, specifier: string, suffix: string): string => {
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      return `${prefix}${pathToFileURL(resolveSnippetPath(markdownFilePath, specifier)).href}${suffix}`;
    }

    return `${prefix}${specifier}${suffix}`;
  };

  return script
    .replace(/(\bfrom\s+['"])([^'"]+)(['"])/g, rewrite)
    .replace(/(\bimport\s*['"])([^'"]+)(['"])/g, rewrite);
}

function extractRegion(source: string, anchor: string): string | undefined {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(String.raw`^(?:\s*(?://|#|/\*+|<!--)\s*#region\s+${escaped}\b.*)$`, 'm');
  const endPattern = new RegExp(String.raw`^(?:\s*(?://|#|/\*+|<!--)\s*#endregion\s+${escaped}\b.*)$`, 'm');

  const startMatch = startPattern.exec(source);
  if (startMatch === null || startMatch.index === undefined) {
    return undefined;
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const remaining = source.slice(startIndex);
  const endMatch = endPattern.exec(remaining);
  if (endMatch === null || endMatch.index === undefined) {
    return undefined;
  }

  return remaining.slice(0, endMatch.index).replace(/^\n+|\n+$/g, '');
}

function inlineSnippetIncludes(body: string, markdownFilePath: string): string {
  const lines = body.split('\n');
  const expanded: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      expanded.push(line);
      continue;
    }

    const includeMatch = /^<<<\s+(.+)$/.exec(trimmed);
    if (includeMatch === null) {
      expanded.push(line);
      continue;
    }

    const [pathPart, anchor] = includeMatch[1].trim().split('#');
    const resolvedPath = resolveSnippetPath(markdownFilePath, pathPart);
    const source = readFileSync(resolvedPath, 'utf8');
    const snippet = anchor !== undefined ? extractRegion(source, anchor) : source.trimEnd();
    const content = (snippet ?? source).trimEnd();

    if (inCodeFence) {
      expanded.push(content);
      continue;
    }

    const language = languageForPath(resolvedPath);
    expanded.push(`\`\`\`${language}`);
    expanded.push(content);
    expanded.push('```');
  }

  return expanded.join('\n');
}

function toTempModulePath(markdownFilePath: string): string {
  const safeName = relative(docsRoot, markdownFilePath)
    .replaceAll('\\', '/')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replaceAll('/', '__');
  return join(docEmbedTempRoot, `${safeName}.mts`);
}

function collectDiagramBindings(body: string): readonly { readonly dag: string; readonly condition?: string; readonly title: string; readonly ariaLabel: string; }[] {
  return Array.from(body.matchAll(/<DagJsonMermaid\b([^>]*)\/?>/g), ([full, attributes]) => {
    const dag = /:dag="([^"]+)"/.exec(full)?.[1];
    const condition = /v-if="([^"]+)"/.exec(full)?.[1];
    const title = /title="([^"]+)"/.exec(full)?.[1] ?? 'Diagram';
    const ariaLabel = /aria-label="([^"]+)"/.exec(full)?.[1] ?? `${title} Mermaid diagram`;

    if (dag === undefined) {
      throw new Error(`DagJsonMermaid tag in ${attributes} is missing a :dag binding.`);
    }

    return { dag, condition, title, ariaLabel };
  });
}

async function evaluateScriptBindings(markdownFilePath: string, body: string): Promise<Readonly<Record<string, unknown>>> {
  const script = extractScriptSetup(body);
  const bindings = collectDiagramBindings(body);
  const identifiers = Array.from(new Set(bindings.flatMap((binding) => [
    binding.dag,
    ...(binding.condition !== undefined ? [binding.condition] : [])
  ]))).filter((identifier) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier));

  if (script === undefined || identifiers.length === 0) {
    return {};
  }

  const tempModulePath = toTempModulePath(markdownFilePath);
  const exportList = identifiers.join(', ');
  writeFileSync(tempModulePath, `${rewriteScriptImportSpecifiers(script, markdownFilePath)}\nexport { ${exportList} };\n`, 'utf8');

  const loaded = await import(/* @vite-ignore */ `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`) as Record<string, unknown>;
  return Object.fromEntries(identifiers.map((identifier) => [identifier, loaded[identifier]]));
}

function resolveBooleanBinding(binding: string | undefined, values: Readonly<Record<string, unknown>>): boolean {
  if (binding === undefined) {
    return true;
  }

  return Boolean(values[binding]);
}

async function replaceSpecialEmbeds(body: string, markdownFilePath: string): Promise<string> {
  const bindings = collectDiagramBindings(body);
  if (bindings.length === 0 && !body.includes('<ExperimentalHomeHero')) {
    return body;
  }

  const values = await evaluateScriptBindings(markdownFilePath, body);

  return body
    .replace(/<DagJsonMermaid\b([^>]*)\/?>/g, (full) => {
      const dag = /:dag="([^"]+)"/.exec(full)?.[1];
      const condition = /v-if="([^"]+)"/.exec(full)?.[1];
      const title = /title="([^"]+)"/.exec(full)?.[1] ?? 'Diagram';
      const ariaLabel = /aria-label="([^"]+)"/.exec(full)?.[1] ?? `${title} Mermaid diagram`;

      if (dag === undefined || !resolveBooleanBinding(condition, values)) {
        return '';
      }

      const resolvedDag = values[dag];
      if (resolvedDag === undefined) {
        return [
          `> Diagram reference`,
          `>`,
          `> **${title}**`,
          `> Diagram data could not be resolved during the Astro build.`,
          ''
        ].join('\n');
      }

      return renderDocDiagramEmbed({
        dag: resolvedDag,
        title,
        ariaLabel
      });
    })
    .replace(
      /<ExperimentalHomeHero\s*\/?>/g,
      [
        '> Experimental surface',
        '>',
        '> **Experimental home hero**',
        '> This experiment maps to the Astro marketing shell rather than the legacy embedded docs component.',
        ''
      ].join('\n')
    );
}

const docs = defineCollection({
  loader: {
    name: 'dagonizer-docs-loader',
    async load(context) {
      context.store.clear();

      for (const filePath of listMarkdownFiles(docsRoot)) {
        const relativePath = relative(docsRoot, filePath).split('\\').join('/');
        const id = relativePath.replace(/\.md$/, '');
        const source = readFileSync(filePath, 'utf8');
        const { data, body } = parseFrontmatter(source);
        const parsed = await context.parseData({
          id,
          data,
          filePath
        });
        const processedBody = inlineSnippetIncludes(stripScriptSetupBlocks(await replaceSpecialEmbeds(body, filePath)), filePath);
        context.store.set({
          id,
          data: parsed,
          body: processedBody,
          filePath: relative(resolve(repoRoot, 'site'), filePath).split('\\').join('/')
        });
      }
    }
  },
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    hero: z.any().optional(),
    seeAlso: z
      .array(
        z.object({
          text: z.string(),
          link: z.string(),
          description: z.string().optional()
        })
      )
      .optional(),
    nextSteps: z
      .array(
        z.object({
          text: z.string(),
          link: z.string(),
          description: z.string().optional()
        })
      )
      .optional()
  })
});

export const collections = { docs };
