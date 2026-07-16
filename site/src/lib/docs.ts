import { posix } from 'node:path';
import { getCollection, render } from 'astro:content';

export interface DocEntry {
  readonly slug: string;
  readonly url: string;
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly excerpt: string;
  readonly headings: readonly string[];
}

function normalizeInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleFromSlug(slug: string): string {
  return slug
    .split('/')
    .at(-1)!
    .replace(/^\d+-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

    const normalized = normalizeInline(line.replace(/^[-*]\s+/, ''));
    if (normalized.length > 40) {
      paragraphs.push(normalized);
    }
  }

  return paragraphs[0] ?? '';
}

function slugToSourcePath(slug: string): string {
  return slug === 'index' ? 'index.md' : `${slug}.md`;
}

async function toDocEntry(entry: Awaited<ReturnType<typeof getCollection<'docs'>>>[number]): Promise<DocEntry> {
  const rendered = await render(entry);
  const headings = rendered.headings.map((heading) => heading.text);
  const excerpt = extractExcerpt(entry.body);

  return {
    slug: entry.id,
    url: `/docs/${entry.id === 'index' ? '' : entry.id}`.replace(/\/$/, '') || '/docs',
    section: toSectionFromSlug(entry.id),
    title: entry.data.title ?? headings[0] ?? toTitleFromSlug(entry.id),
    description: entry.data.description ?? excerpt,
    excerpt,
    headings
  };
}

export async function getDocsCatalog(): Promise<readonly DocEntry[]> {
  const entries = await getCollection('docs');
  return Promise.all(entries.sort((left, right) => left.id.localeCompare(right.id)).map(toDocEntry));
}

export async function getDocBySlug(slug: string): Promise<DocEntry | undefined> {
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, '') || 'index';
  const entries = await getDocsCatalog();
  return entries.find((entry) => entry.slug === normalizedSlug);
}

export async function getDocSections(): Promise<readonly { readonly name: string; readonly entries: readonly DocEntry[] }[]> {
  const docsCatalog = await getDocsCatalog();
  const grouped = new Map<string, DocEntry[]>();

  for (const entry of docsCatalog) {
    const entries = grouped.get(entry.section) ?? [];
    entries.push(entry);
    grouped.set(entry.section, entries);
  }

  return Array.from(grouped.entries())
    .map(([name, entries]) => ({ name, entries }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function toEditUrl(source: string): string {
  const normalizedSource = source.endsWith('.md') ? source : slugToSourcePath(source.replace(/^\/+|\/+$/g, '') || 'index');
  const repositoryRelativePath = posix.join('docs', normalizedSource.split('\\').join('/'));
  return `https://github.com/Studnicky/Dagonizer/blob/main/${repositoryRelativePath}`;
}
