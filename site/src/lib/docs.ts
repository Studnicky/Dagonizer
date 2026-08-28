import { posix } from 'node:path';
import { getCollection } from 'astro:content';
import { SiteLinks } from '@/lib/links';
import { DocPageRenderer } from '@/lib/render-doc-page';

interface DocEntry {
  readonly slug: string;
  readonly url: string;
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly excerpt: string;
  readonly headings: readonly string[];
}

const DOC_SECTION_LABELS: Readonly<Record<string, string>> = {
  experiments: 'Runtime Overviews'
};

function inlineText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleFromSlug(slug: string): string {
  const lastSegment = slug.split('/').at(-1);
  if (lastSegment === undefined) {
    throw new Error(`Documentation slug has no title segment: ${slug}`);
  }

  return lastSegment
    .replace(/^\d+-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toSectionDisplayName(section: string): string {
  return DOC_SECTION_LABELS[section] ?? toTitleFromSlug(section);
}

function toDisplayTitle(entry: Awaited<ReturnType<typeof getCollection<'docs'>>>[number]): string {
  return entry.data.title ?? DocPageRenderer.leadingTitle(entry.body) ?? toTitleFromSlug(entry.id);
}

function toSectionFromSlug(slug: string): string {
  const [firstSegment] = slug.split('/');
  return firstSegment === slug ? 'overview' : firstSegment;
}

function extractExcerpt(body: string): string {
  const lines = body.split('\n');
  const paragraphs: string[] = [];
  let inCodeFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || line.length === 0 || line.startsWith('<<<') || line.startsWith('<')) {
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      continue;
    }

    const excerptLine = inlineText(line.replace(/^[-*]\s+/, ''));
    if (excerptLine.length > 40) {
      paragraphs.push(excerptLine);
    }
  }

  return paragraphs[0] ?? '';
}

async function toDocEntry(entry: Awaited<ReturnType<typeof getCollection<'docs'>>>[number]): Promise<DocEntry> {
  const rendered = await DocPageRenderer.render(entry.body, {
    title: toDisplayTitle(entry),
    slug: entry.id
  });
  const headings = rendered.headings.map((heading) => heading.text);
  const excerpt = extractExcerpt(entry.body);

  return {
    slug: entry.id,
    url: SiteLinks.route(entry.id),
    section: toSectionFromSlug(entry.id),
    title: toDisplayTitle(entry),
    description: entry.data.description ?? excerpt,
    excerpt,
    headings
  };
}

export const SiteDocs = {
  async catalog(): Promise<readonly DocEntry[]> {
    const entries = await getCollection('docs');
    return Promise.all(entries.sort((left, right) => left.id.localeCompare(right.id)).map(toDocEntry));
  },

  async bySlug(slug: string): Promise<DocEntry | undefined> {
    SiteLinks.route(slug);
    const entries = await SiteDocs.catalog();
    return entries.find((entry) => entry.slug === slug);
  },

  async sections(): Promise<readonly { readonly name: string; readonly entries: readonly DocEntry[] }[]> {
    const docsCatalog = await SiteDocs.catalog();
    const grouped = new Map<string, DocEntry[]>();

    for (const entry of docsCatalog) {
      const entries = grouped.get(entry.section) ?? [];
      entries.push(entry);
      grouped.set(entry.section, entries);
    }

    return Array.from(grouped.entries())
      .map(([name, entries]) => ({ name: toSectionDisplayName(name), entries }))
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  edit(slug: string): string {
    SiteLinks.route(slug);
    const sourcePath = slug === 'index' ? 'index.md' : `${slug}.md`;
    return SiteLinks.repository(posix.join('docs', sourcePath));
  }
};
