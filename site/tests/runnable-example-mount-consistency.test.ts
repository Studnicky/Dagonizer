import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function fixture(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

const STANDALONE_ENTRYPOINTS = [
  '../../examples/the-archivist/main.ts',
  '../../examples/the-cartographer/main.ts',
  '../../examples/the-dispatcher/main.ts',
] as const;

const DEDICATED_EXAMPLE_PAGES = [
  {
    'example': 'archivist',
    'path': '../../site/src/pages/examples/the-archivist.astro',
  },
  {
    'example': 'cartographer',
    'path': '../../site/src/pages/examples/the-cartographer.astro',
  },
  {
    'example': 'dispatcher',
    'path': '../../site/src/pages/examples/the-dispatcher.astro',
  },
] as const;

const SHARED_DOC_EXAMPLE_PAGES = [
  {
    'example': 'archivist',
    'path': '../../docs/examples/the-archivist.md',
  },
  {
    'example': 'cartographer',
    'path': '../../docs/examples/the-cartographer.md',
  },
  {
    'example': 'dispatcher',
    'path': '../../docs/examples/the-dispatcher.md',
  },
] as const;

const SHARED_ASTRO_EXAMPLE_PAGE = '../../site/src/components/marketing/RunnableExamplePage.astro';
const SHARED_RUNNABLE_EXAMPLE_RUNNER = '../../site/src/components/islands/RunnableExampleRunner.vue';
const DOCS_THEME_INDEX = '../../docs/.vitepress/theme/index.ts';
const STANDALONE_MOUNT_HELPER = '../../examples/runnable-example/standaloneRunnableExample.ts';

const REMOVED_WRAPPER_FILES = [
  '../../site/src/components/islands/RunnableExampleIsland.vue',
  '../../site/src/components/islands/LazyArchivistRunner.vue',
  '../../site/src/components/islands/LazyCartographerRunner.vue',
  '../../site/src/components/islands/LazyDispatcherRunner.vue',
  '../../docs/.vitepress/theme/components/ArchivistRunner.vue',
  '../../docs/.vitepress/theme/components/CartographerRunner.vue',
  '../../docs/.vitepress/theme/components/DispatcherRunner.vue',
  '../../docs/.vitepress/theme/components/RunnableExampleRunner.vue',
  '../../site/src/lib/doc-runnable-example-client.ts',
] as const;

const SHARED_WORKBENCH_RUNNERS = [
  '../../examples/the-archivist/app/ArchivistRunner.vue',
  '../../examples/the-cartographer/app/CartographerRunner.vue',
  '../../examples/the-dispatcher/app/DispatcherRunner.vue',
] as const;

test('standalone example entrypoints share the same runnable-example bootstrap helper', async () => {
  for (const path of STANDALONE_ENTRYPOINTS) {
    const source = await readFile(fixture(path), 'utf8');

    assert.match(source, /mountStandaloneRunnableExample/);
    assert.doesNotMatch(source, /createApp\(/);
  }
});

test('dedicated Astro example pages share the same island mount contract', async () => {
  for (const page of DEDICATED_EXAMPLE_PAGES) {
    const source = await readFile(fixture(page.path), 'utf8');

    assert.match(source, /import RunnableExamplePage from ['"]@\/components\/marketing\/RunnableExamplePage\.astro['"]/);
    assert.match(source, new RegExp(`const page = runnableExamplePageFor\\('${page.example}'\\);`));
    assert.match(source, /<RunnableExamplePage \{\.\.\.page\} \/>/);
    assert.doesNotMatch(source, /RunnableExampleIsland|RunnableExampleShell|Lazy(?:Archivist|Cartographer|Dispatcher)Runner/);
  }
});

test('docs example source pages point at the canonical runnable example routes instead of embedding a second mount', async () => {
  for (const page of SHARED_DOC_EXAMPLE_PAGES) {
    const source = await readFile(fixture(page.path), 'utf8');

    assert.doesNotMatch(source, /<RunnableExampleRunner\b/);
    assert.match(source, new RegExp(`\\(/examples/the-${page.example}\\)`));
  }
});

test('shared Astro example page owns the common shell and island mount', async () => {
  const source = await readFile(fixture(SHARED_ASTRO_EXAMPLE_PAGE), 'utf8');

  assert.match(source, /import RunnableExampleRunner from ['"]@\/components\/islands\/RunnableExampleRunner\.vue['"]/);
  assert.match(source, /import RunnableExampleShell from ['"]@\/components\/marketing\/RunnableExampleShell\.astro['"]/);
  assert.match(source, /<RunnableExampleRunner example=\{example\} client:load \/>/);
});

test('VitePress registers one shared runnable example wrapper', async () => {
  const source = await readFile(fixture(DOCS_THEME_INDEX), 'utf8');

  assert.match(source, /import RunnableExampleRunner from ['"]\.\.\/\.\.\/\.\.\/site\/src\/components\/islands\/RunnableExampleRunner\.vue['"]/);
  assert.match(source, /app\.component\('RunnableExampleRunner', RunnableExampleRunner\)/);
});

test('all docs and site mounts share one runnable example runner', async () => {
  const [runnerSource, standaloneSource] = await Promise.all([
    readFile(fixture(SHARED_RUNNABLE_EXAMPLE_RUNNER), 'utf8'),
    readFile(fixture(STANDALONE_MOUNT_HELPER), 'utf8'),
  ]);

  assert.match(runnerSource, /RunnableExampleMount/);
  assert.match(runnerSource, /runnerProps/);
  assert.match(standaloneSource, /createApp\(RunnableExampleMount, \{/);
});

test('removed per-example runner wrappers stay deleted', () => {
  for (const path of REMOVED_WRAPPER_FILES) {
    assert.equal(existsSync(fixture(path)), false, `${path} should not exist`);
  }
});

test('example runner roots share the same workbench shell component', async () => {
  for (const path of SHARED_WORKBENCH_RUNNERS) {
    const source = await readFile(fixture(path), 'utf8');
    assert.match(source, /import RunnableExampleWorkbench from ['"]\.\.\/\.\.\/runnable-example\/RunnableExampleWorkbench\.vue['"]/);
    assert.match(source, /<RunnableExampleWorkbench[\s\S]*?>[\s\S]*<\/RunnableExampleWorkbench>/);
  }
});
