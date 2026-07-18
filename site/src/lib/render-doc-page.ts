import { posix } from 'node:path';
import { marked } from 'marked';
import { SiteLinks } from '@/lib/links';

interface DocHeading {
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

function inlineText(text: string): string {
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
      displayText: inlineText(text),
      slug: undefined
    };
  }

  return {
    displayText: inlineText(rawText.slice(0, explicitMatch.index).trimEnd()),
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

function stripGenericSegments(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function getLeadingMarkdownTitle(body: string): string | undefined {
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

    return inlineText(match[1]);
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
  const expectedTitle = inlineText(title).toLowerCase();
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

    if (inlineText(match[1]).toLowerCase() !== expectedTitle) {
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

function isRepositorySourcePath(path: string): boolean {
  return /\.(?:tsx?|jsx?|json)$/.test(path);
}

function resolveDocHref(currentSlug: string | undefined, href: string): string {
  if (href.length === 0 || href === '#' || href.startsWith('#') || isExternalHref(href)) {
    return href;
  }

  const hashIndex = href.indexOf('#');
  const hrefWithoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hashSuffix = hashIndex === -1 ? '' : href.slice(hashIndex);
  const queryIndex = hrefWithoutHash.indexOf('?');
  const pathPart = queryIndex === -1 ? hrefWithoutHash : hrefWithoutHash.slice(0, queryIndex);
  const querySuffix = queryIndex === -1 ? '' : hrefWithoutHash.slice(queryIndex);

  if (pathPart === '' || pathPart === '.') {
    const currentRoute = SiteLinks.route(currentSlug ?? 'index');
    return `${SiteLinks.site(currentRoute)}${querySuffix}${hashSuffix}`;
  }

  if (pathPart === '/') {
    return `${SiteLinks.site('/')}${querySuffix}${hashSuffix}`;
  }

  const currentDir = currentSlug === undefined || currentSlug === 'index' ? '.' : posix.dirname(currentSlug);
  if (isRepositorySourcePath(pathPart)) {
    const repositoryPath = posix.join('docs', currentDir, pathPart);
    return `${SiteLinks.repository(repositoryPath)}${querySuffix}${hashSuffix}`;
  }

  if (pathPart.startsWith('/')) {
    if (pathPart === '/docs') {
      return `${SiteLinks.site('/docs')}${querySuffix}${hashSuffix}`;
    }

    const withoutExtension = pathPart.endsWith('.md') ? pathPart.slice(0, -'.md'.length) : pathPart;
    const withoutIndex = withoutExtension.endsWith('/index')
      ? withoutExtension.slice(0, -'/index'.length)
      : withoutExtension;
    const routePath = withoutIndex.startsWith('/docs/') ? withoutIndex.slice('/docs'.length) : withoutIndex;
    const absoluteSlug = routePath.length === 0 ? 'index' : routePath.slice(1);
    const firstSeparator = absoluteSlug.indexOf('/');
    const firstSegment = firstSeparator === -1 ? absoluteSlug : absoluteSlug.slice(0, firstSeparator);
    const targetPath = DOC_ROOT_SEGMENTS.has(firstSegment)
      ? SiteLinks.site(SiteLinks.route(absoluteSlug))
      : SiteLinks.site(pathPart);
    return `${targetPath}${querySuffix}${hashSuffix}`;
  }

  const relativePath = posix.join(currentDir, pathPart);
  const withoutExtension = relativePath.endsWith('.md') ? relativePath.slice(0, -'.md'.length) : relativePath;
  const withoutIndex = withoutExtension.endsWith('/index')
    ? withoutExtension.slice(0, -'/index'.length)
    : withoutExtension;
  const resolvedSlug = withoutIndex.length === 0 ? 'index' : withoutIndex;
  return `${SiteLinks.site(SiteLinks.route(resolvedSlug))}${querySuffix}${hashSuffix}`;
}

export const DocPageRenderer = {
  leadingTitle(body: string): string | undefined {
    return getLeadingMarkdownTitle(body);
  },

  async render(body: string, options?: {
    readonly title?: string;
    readonly slug?: string;
  }): Promise<{
    readonly html: string;
    readonly headings: readonly DocHeading[];
  }> {
    const transformedBody = stripUnsupportedDocTags(transformSpecialEmbeds(body));
    const renderBody = options?.title ? stripLeadingTitleHeading(transformedBody, options.title) : transformedBody;
    const headings = collectHeadings(renderBody);
    const renderer = new marked.Renderer();

    renderer.heading = ({ tokens, depth }) => {
      const renderedText = renderer.parser.parseInline(tokens);
      const { displayText, slug } = extractExplicitHeadingSlug(renderedText);
      const headingSlug = slug ?? slugifyHeading(displayText);
      return `<h${depth} id="${headingSlug}">${displayText}</h${depth}>`;
    };

    renderer.link = ({ href, title, tokens }) => {
      const text = renderer.parser.parseInline(tokens);
      const resolvedHref = resolveDocHref(options?.slug, href ?? '');
      const titleAttribute = title ? ` title="${title}"` : '';
      return `<a href="${resolvedHref}"${titleAttribute}>${text}</a>`;
    };

    return {
      html: await marked.parse(renderBody, {
        gfm: true,
        renderer
      }),
      headings
    };
  }
};
