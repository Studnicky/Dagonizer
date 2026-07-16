import { posix } from 'node:path';
import { marked } from 'marked';
import { repositoryHref, siteHref } from '@/lib/links';

export interface DocHeading {
  readonly depth: number;
  readonly slug: string;
  readonly text: string;
}

const DOC_ROOT_SEGMENTS = new Set([
  'architecture',
  'concepts',
  'examples',
  'experiments',
  'getting-started',
  'guide',
  'index',
  'internal',
  'reference'
]);

function normalizeInline(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"');
}

function extractExplicitHeadingSlug(text: string): {
  readonly displayText: string;
  readonly slug: string | undefined;
} {
  const rawText = decodeHtmlEntities(text).replace(/<[^>]+>/g, '').trim();
  const explicitMatch = /\s+\{#([A-Za-z0-9_-]+)\}$/.exec(rawText);
  if (explicitMatch === null) {
    return {
      displayText: normalizeInline(text),
      slug: undefined
    };
  }

  return {
    displayText: normalizeInline(rawText.slice(0, explicitMatch.index).trimEnd()),
    slug: explicitMatch[1]
  };
}

function slugifyHeading(text: string): string {
  const { displayText, slug } = extractExplicitHeadingSlug(text);
  if (slug !== undefined) {
    return slug;
  }

  return stripGenericSegments(displayText)
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function slugifyIdentifier(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripGenericSegments(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function slugifyHeadingLegacy(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function buildHeadingAliases(displayText: string, slug: string): readonly string[] {
  const aliases = new Set<string>();
  const legacySlug = slugifyHeadingLegacy(displayText);
  if (legacySlug.length > 0 && legacySlug !== slug) {
    aliases.add(legacySlug);
  }

  const classMatch = /^Class:\s+([A-Za-z0-9_]+)/.exec(displayText);
  if (classMatch !== null) {
    aliases.add(`class-${slugifyIdentifier(classMatch[1])}`);
  }

  const abstractClassMatch = /^Abstract class:\s+([A-Za-z0-9_]+)/.exec(displayText);
  if (abstractClassMatch !== null) {
    aliases.add(`abstract-class-${slugifyIdentifier(abstractClassMatch[1])}`);
  }

  const interfaceMatch = /^Interface:\s+([A-Za-z0-9_]+)/.exec(displayText);
  if (interfaceMatch !== null) {
    aliases.add(`interface-${slugifyIdentifier(interfaceMatch[1].replace(/Interface$/, ''))}`);
  }

  const typeMatch = /^Type:\s+([A-Za-z0-9_]+)/.exec(displayText);
  if (typeMatch !== null) {
    aliases.add(slugifyIdentifier(typeMatch[1]));
  }

  if (displayText === '.terminal(name, options?)') {
    aliases.add('terminal-name-outcome');
  }

  if (displayText === 'Scatter and workset progress') {
    aliases.add('scatter-resume-per-item-progress');
  }

  if (displayText === 'Distributed execution: RemoteStore') {
    aliases.add('distributed-execution--remotestore');
  }

  if (displayText === 'DAGDocument.load(json, options?)') {
    aliases.add('dagdocumentloadjson-options');
  }

  if (displayText === 'DAGDocument.serialize(dag)') {
    aliases.add('dagdocumentserializedag');
  }

  if (displayText === 'RetryPolicy.run(task, options?)') {
    aliases.add('retrypolicyruntask-options');
  }

  if (displayText === 'Checkpoint.load(raw)') {
    aliases.add('checkpointloadraw');
  }

  if (displayText === 'Checkpoint.recall(store, key)') {
    aliases.add('checkpointrecallstore-key');
  }

  if (displayText === 'ckpt.toJson()') {
    aliases.add('ckpttojson');
  }

  if (displayText === 'ckpt.persist(store, key)') {
    aliases.add('ckptpersiststore-key');
  }

  if (displayText === 'ckpt.restoreState(adapter)') {
    aliases.add('ckptrestorestateadapter');
  }

  if (displayText === 'ckpt.data') {
    aliases.add('ckptdata');
  }

  if (displayText === 'SchedulerProviderInterface interface') {
    aliases.add('schedulerproviderinterface-interface');
  }

  if (displayText === 'Combining with the dispatcher\'s read accessors') {
    aliases.add('combining-with-the-dispatchers-read-accessors');
  }

  if (displayText === 'async mount(): Promise<cytoscape.Core>') {
    aliases.add('async-mount-promise');
  }

  return Array.from(aliases).filter((alias) => alias.length > 0 && alias !== slug);
}

function renderHeadingAliases(aliases: readonly string[]): string {
  return aliases
    .map((alias) => `<a id="${alias}" aria-hidden="true" tabindex="-1" class="doc-anchor-alias"></a>`)
    .join('');
}

export function getLeadingMarkdownTitle(body: string): string | undefined {
  const lines = body.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || trimmed.length === 0) {
      continue;
    }

    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match === null) {
      return undefined;
    }

    return normalizeInline(match[1]);
  }

  return undefined;
}

function toMarkdownCallout(eyebrow: string, title: string, body: string): string {
  return [
    `> ${eyebrow}`,
    `>`,
    `> **${title}**`,
    `> ${body}`,
    ''
  ].join('\n');
}

function transformSpecialEmbeds(body: string): string {
  return body
    .replace(
      /<ExperimentalHomeHero\s*\/?>/g,
      toMarkdownCallout(
        'Experimental surface',
        'Experimental home hero',
        'This experiment maps to the Astro marketing shell rather than the legacy embedded docs component.'
      )
    );
}

function stripUnsupportedDocTags(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      kept.push(line);
      continue;
    }

    if (!inCodeFence) {
      if (/^\s*<\/?ClientOnly>\s*$/.test(line)) {
        continue;
      }

      if (/^\s*<[A-Z][A-Za-z0-9]*(?:\s+[^>]*)?\/?>\s*$/.test(line)) {
        continue;
      }
    }

    kept.push(line);
  }

  return kept.join('\n');
}

function stripLeadingTitleHeading(body: string, title: string): string {
  const normalizedTitle = normalizeInline(title).toLowerCase();
  const lines = body.split('\n');
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || trimmed.length === 0) {
      continue;
    }

    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match === null) {
      return body;
    }

    if (normalizeInline(match[1]).toLowerCase() !== normalizedTitle) {
      return body;
    }

    const nextIndex = index + 1 < lines.length && lines[index + 1].trim().length === 0 ? index + 2 : index + 1;
    return [...lines.slice(0, index), ...lines.slice(nextIndex)].join('\n');
  }

  return body;
}

function collectHeadings(body: string): readonly DocHeading[] {
  const headings: DocHeading[] = [];
  const lines = body.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const match = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (match === null) {
      continue;
    }

    const text = extractExplicitHeadingSlug(match[2]).displayText;
    if (text.length === 0) {
      continue;
    }

    headings.push({
      depth: match[1].length,
      slug: slugifyHeading(text),
      text
    });
  }

  return headings;
}

function isExternalHref(href: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:');
}

function normalizeDocTargetPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const withoutExtension = normalized.replace(/\.md$/i, '');
  const withoutIndex = withoutExtension.replace(/\/index$/i, '');
  return withoutIndex === '' ? 'index' : withoutIndex.replace(/^\/+|\/+$/g, '') || 'index';
}

function isRepositorySourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.js') || normalized.endsWith('.jsx') || normalized.endsWith('.json');
}

function resolveRepositoryHref(currentSlug: string | undefined, pathPart: string): string | undefined {
  if (!isRepositorySourcePath(pathPart)) {
    return undefined;
  }

  const currentDir = currentSlug === undefined || currentSlug === 'index' ? '.' : posix.dirname(currentSlug);
  const docsRelativePath = posix.normalize(posix.join('docs', currentDir, pathPart));
  const repositoryRelativePath = posix.normalize(posix.join(posix.dirname(docsRelativePath), pathPart));
  const withoutLeadingTraversal = repositoryRelativePath.replace(/^(\.\.\/)+/g, '');
  return repositoryHref(withoutLeadingTraversal);
}

function resolveDocHref(currentSlug: string | undefined, href: string): string {
  if (href.length === 0 || href === '#' || href.startsWith('#') || isExternalHref(href)) {
    return href;
  }

  const [rawPath, rawHash = ''] = href.split('#', 2);
  const hashSuffix = rawHash.length > 0 ? `#${rawHash}` : '';
  const [pathPart, rawQuery = ''] = rawPath.split('?', 2);
  const querySuffix = rawQuery.length > 0 ? `?${rawQuery}` : '';

  if (pathPart === '' || pathPart === '.') {
    return `${siteHref(`/docs/${currentSlug === undefined || currentSlug === 'index' ? '' : currentSlug}`)}${querySuffix}${hashSuffix}`;
  }

  if (pathPart === '/') {
    return `${siteHref('/')}${querySuffix}${hashSuffix}`;
  }

  const repositorySourceHref = resolveRepositoryHref(currentSlug, pathPart);
  if (repositorySourceHref !== undefined) {
    return `${repositorySourceHref}${querySuffix}${hashSuffix}`;
  }

  if (pathPart.startsWith('/')) {
    const normalizedAbsolute = normalizeDocTargetPath(pathPart);
    const firstSegment = normalizedAbsolute.split('/')[0];
    const targetPath = DOC_ROOT_SEGMENTS.has(firstSegment)
      ? siteHref(`/docs/${normalizedAbsolute === 'index' ? '' : normalizedAbsolute}`)
      : siteHref(pathPart);
    return `${targetPath}${querySuffix}${hashSuffix}`;
  }

  const currentDir = currentSlug === undefined || currentSlug === 'index' ? '.' : posix.dirname(currentSlug);
  const resolvedRelative = normalizeDocTargetPath(posix.normalize(posix.join(currentDir, pathPart)));
  return `${siteHref(`/docs/${resolvedRelative === 'index' ? '' : resolvedRelative}`)}${querySuffix}${hashSuffix}`;
}

export async function renderDocPage(body: string, options?: {
  readonly title?: string;
  readonly slug?: string;
}): Promise<{
  readonly html: string;
  readonly headings: readonly DocHeading[];
}> {
  const transformedBody = stripUnsupportedDocTags(transformSpecialEmbeds(body));
  const normalizedBody = options?.title ? stripLeadingTitleHeading(transformedBody, options.title) : transformedBody;
  const headings = collectHeadings(normalizedBody);
  const renderer = new marked.Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const renderedText = renderer.parser.parseInline(tokens);
    const { displayText, slug } = extractExplicitHeadingSlug(renderedText);
    const headingSlug = slug ?? slugifyHeading(displayText);
    const aliases = renderHeadingAliases(buildHeadingAliases(displayText, headingSlug));
    return `${aliases}<h${depth} id="${headingSlug}">${displayText}</h${depth}>`;
  };

  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    const resolvedHref = resolveDocHref(options?.slug, href ?? '');
    const titleAttribute = title ? ` title="${title}"` : '';
    return `<a href="${resolvedHref}"${titleAttribute}>${text}</a>`;
  };

  return {
    html: await marked.parse(normalizedBody, {
      gfm: true,
      renderer
    }),
    headings
  };
}
