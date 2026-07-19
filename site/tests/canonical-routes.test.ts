import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SiteLinks } from '../src/lib/links';
import { DocPageRenderer } from '../src/lib/render-doc-page';

const docsRoot = fileURLToPath(new URL('../../docs/', import.meta.url));
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const publicSections = new Set(['guide', 'examples', 'reference', 'internal', 'experiments']);
const overviewSlugs = new Set(['index', 'architecture', 'concepts', 'getting-started']);

async function getCorpusSlugs(): Promise<readonly string[]> {
  const paths = await readdir(docsRoot, { recursive: true });
  return paths
    .filter((path) => path.endsWith('.md') && !path.split(sep).some((segment) => segment.startsWith('.')))
    .map((path) => path.split(sep).join('/').slice(0, -'.md'.length))
    .sort((left, right) => left.localeCompare(right));
}

function builtPageForRoute(route: string): string {
  return route === '/' ? join(distRoot, 'index.html') : join(distRoot, route.slice(1), 'index.html');
}

function runnableExampleIslandContract(html: string): {
  readonly componentUrl: string;
  readonly example: string;
} {
  const matches = [...html.matchAll(
    /<astro-island\b[^>]*component-url="([^"]*RunnableExampleRunner[^"]*)"[^>]*client="load"[^>]*>[\s\S]*?data-runnable-example="([^"]+)"/g,
  )];

  assert.equal(matches.length, 1, 'expected exactly one emitted RunnableExampleRunner island');

  const [componentUrl, example] = matches[0]!.slice(1);
  assert.ok(typeof componentUrl === 'string' && componentUrl.length > 0);
  assert.ok(typeof example === 'string' && example.length > 0);

  return { componentUrl, example };
}

async function renderedCorpus(): Promise<ReadonlyMap<string, string>> {
  const pages = new Map<string, string>();

  for (const slug of await getCorpusSlugs()) {
    const source = await readFile(join(docsRoot, `${slug}.md`), 'utf8');
    const title = DocPageRenderer.leadingTitle(source);
    const rendered = await DocPageRenderer.render(source, { title, slug });
    pages.set(SiteLinks.route(slug), rendered.html);
  }

  return pages;
}

test('the docs corpus has one canonical public route with the configured base path', async () => {
  const slugs = await getCorpusSlugs();
  const routes = slugs.map(SiteLinks.route);

  assert.equal(new Set(routes).size, slugs.length);
  assert.equal(slugs.length, 103);
  assert.ok(!routes.some((route) => route === '/docs' || route.startsWith('/docs/')));

  for (const [index, slug] of slugs.entries()) {
    const firstSegment = slug.split('/')[0];
    assert.ok(overviewSlugs.has(slug) || publicSections.has(firstSegment), `Unexpected public docs root: ${slug}`);
    assert.equal(SiteLinks.site(routes[index]), routes[index] === '/' ? '/Dagonizer' : `/Dagonizer${routes[index]}`);
    await readFile(builtPageForRoute(routes[index]), 'utf8');
  }
});

test('the docs catalog links every corpus entry to its canonical route', async () => {
  const catalogHtml = await readFile(join(distRoot, 'docs', 'index.html'), 'utf8');

  for (const slug of await getCorpusSlugs()) {
    assert.ok(catalogHtml.includes(SiteLinks.site(SiteLinks.route(slug))), `Catalog omits canonical route for ${slug}`);
  }
});

test('/docs content pages are additive redirects to canonical routes', async () => {
  for (const slug of await getCorpusSlugs()) {
    if (slug === 'index') {
      continue;
    }

    const redirectHtml = await readFile(join(distRoot, 'docs', slug, 'index.html'), 'utf8');
    assert.ok(redirectHtml.includes(SiteLinks.site(SiteLinks.route(slug))), `Redirect target is not canonical for ${slug}`);
  }
});

test('Markdown links preserve fragments, queries, external URLs, and repository sources', async () => {
  const rendered = await DocPageRenderer.render(
    [
      '## Local target',
      '',
      '[Local](#local-target)',
      '[Relative](../reference/nodes.md?view=full#scatternode)',
      '[Absolute](/guide/retry#delays)',
      '[Docs-prefixed](/docs/reference/runtime)',
      '[External](https://example.com/reference?q=1#top)',
      '[Source](../../examples/04c-scatter-workers.ts#L1)'
    ].join('\n'),
    { slug: 'guide/current' }
  );

  assert.match(rendered.html, /id="local-target"/);
  assert.match(rendered.html, /href="#local-target"/);
  assert.match(rendered.html, /href="\/Dagonizer\/reference\/nodes\?view=full#scatternode"/);
  assert.match(rendered.html, /href="\/Dagonizer\/guide\/retry#delays"/);
  assert.match(rendered.html, /href="\/Dagonizer\/reference\/runtime"/);
  assert.match(rendered.html, /href="https:\/\/example\.com\/reference\?q=1#top"/);
  assert.ok(rendered.html.includes(SiteLinks.repository('examples/04c-scatter-workers.ts')));
});

test('every rendered corpus link targets a canonical route or a valid local fragment', async () => {
  const pages = await renderedCorpus();
  const routes = new Set(pages.keys());
  const sectionRoutes = new Set(Array.from(publicSections, (section) => SiteLinks.route(section)));

  for (const [route, html] of pages) {
    const localIds = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));

    for (const match of html.matchAll(/<a href="([^"]*)"/g)) {
      const href = match[1];
      if (href.startsWith('#')) {
        assert.ok(localIds.has(href.slice(1)), `Missing local fragment ${href} on ${route}`);
        continue;
      }

      if (!href.startsWith('/Dagonizer')) {
        continue;
      }

      const routeAndFragment = href.slice('/Dagonizer'.length) || '/';
      const targetRoute = routeAndFragment.split(/[?#]/, 1)[0] || '/';
      assert.ok(
        routes.has(targetRoute) || sectionRoutes.has(targetRoute) || targetRoute === '/docs',
        `Rendered link from ${route} targets a non-canonical route: ${href}`
      );
    }
  }
});

test('dedicated runnable-example shells and their legacy redirects are emitted', async () => {
  for (const slug of ['examples/the-archivist', 'examples/the-cartographer', 'examples/the-dispatcher']) {
    const route = SiteLinks.route(slug);
    const demoHtml = await readFile(builtPageForRoute(route), 'utf8');
    const redirectHtml = await readFile(join(distRoot, 'docs', slug, 'index.html'), 'utf8');

    assert.match(demoHtml, /Runtime behavior/);
    assert.ok(redirectHtml.includes(SiteLinks.site(route)));
  }
});

test('every runnable example page is emitted through the shared Vue island mount', async () => {
  const sharedComponentUrls = new Set<string>();

  for (const [slug, expectedExample] of [
    ['examples/the-archivist', 'archivist'],
    ['examples/the-cartographer', 'cartographer'],
    ['examples/the-dispatcher', 'dispatcher'],
  ] as const) {
    const demoHtml = await readFile(builtPageForRoute(SiteLinks.route(slug)), 'utf8');
    const contract = runnableExampleIslandContract(demoHtml);

    assert.match(demoHtml, /client="load"/);
    assert.equal(contract.example, expectedExample);
    assert.equal((demoHtml.match(/data-runnable-example="/g) ?? []).length, 1);
    assert.doesNotMatch(demoHtml, /class="(?:archivist|cartographer|dispatcher)-runner/);

    sharedComponentUrls.add(contract.componentUrl);
  }

  assert.equal(sharedComponentUrls.size, 1, 'all runnable example pages must hydrate the same compiled Vue island');
});

test('invalid documentation slugs are rejected instead of rewritten', () => {
  for (const slug of ['', '/guide/retry', 'guide/retry/', 'guide//retry', 'guide/../retry', 'guide/retry.md']) {
    assert.throws(() => SiteLinks.route(slug));
  }

  assert.throws(() => SiteLinks.site('guide/retry'));
  assert.throws(() => SiteLinks.site('/guide/retry/'));
  assert.throws(() => SiteLinks.repository('/examples/04c-scatter-workers.ts'));
});
