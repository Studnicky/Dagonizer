import { fileURLToPath, URL }                from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve }                               from 'node:path';
import { defineConfig, type HeadConfig }          from 'vitepress';
import { transformerTwoslash }                    from '@shikijs/vitepress-twoslash';
import { withMermaid }                           from 'vitepress-plugin-mermaid';
import { transformersEmbedderAssets }             from '../../examples/the-archivist/tooling/transformersEmbedderAssets.ts';
import type { MermaidConfig }                    from 'mermaid';

import pkg from '../../package.json' with { type: 'json' };

/**
 * SEO tokens live in package.json under `dagonizer.seo`. All three values
 * are *explicitly designed to be public*: Google/Bing verification
 * meta tags are not credentials, they're property-ownership markers
 * the registry reads back to confirm the SC account that ships this
 * string owns this domain. Anyone can read them; nobody can abuse them.
 * The Twitter handle is the public-facing account.
 *
 * Empty string suppresses the corresponding head tag at build time:
 * we ship no orphaned meta tags pointing at unowned properties.
 */
interface DagonizerSeoConfig {
  readonly googleSiteVerification: string;
  readonly bingSiteVerification:   string;
  readonly twitterHandle:          string;
}
const seo: DagonizerSeoConfig = (pkg as { 'dagonizer'?: { 'seo'?: DagonizerSeoConfig } }).dagonizer?.seo ?? {
  googleSiteVerification: '',
  bingSiteVerification:   '',
  twitterHandle:          '',
};

/* Verification tokens for search-console enrolment. Once you register
   the property at https://search.google.com/search-console (Google) +
   https://www.bing.com/webmasters (Bing), paste the verification value
   into `package.json` → `dagonizer.seo.{googleSiteVerification,
   bingSiteVerification}` so the next build ships the meta tag.
   Empty string (the default) suppresses the tag: we don't ship orphan
   tags pointing at unowned properties. */
const VERIFY_GOOGLE       = seo.googleSiteVerification;
const VERIFY_BING         = seo.bingSiteVerification;

/* Twitter / X handle for `twitter:site` + `twitter:creator` attribution
   in the unfurl card. Leave empty to omit: a missing handle is better
   than a wrong one, since Twitter's validator drops the entire card if
   `twitter:site` resolves to a deleted account. Set in `package.json`
   → `dagonizer.seo.twitterHandle` (include the `@`). */
const SITE_TWITTER_HANDLE = seo.twitterHandle;

// Repo paths the in-browser ArchivistRunner Vue component imports from.
const REPO_ROOT     = fileURLToPath(new URL('../..', import.meta.url));
const ARCHIVIST     = fileURLToPath(new URL('../../examples/the-archivist', import.meta.url));
const CARTOGRAPHER  = fileURLToPath(new URL('../../examples/the-cartographer', import.meta.url));
const VIZ_SRC       = fileURLToPath(new URL('../../src/viz', import.meta.url));

const sidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'Dagonizer',       link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
    ],
  },
  {
    // Vocabulary and theory: read before or alongside the demos.
    text: 'Concepts',
    collapsed: false,
    items: [
      { text: 'Concepts',     link: '/concepts' },
      { text: 'Architecture', link: '/architecture' },
    ],
  },
  {
    // The three browser-runnable apps are the proof points every guide page references.
    text: 'Demos',
    collapsed: false,
    items: [
      { text: 'The Archivist',    link: '/examples/the-archivist' },
      { text: 'The Cartographer', link: '/examples/the-cartographer' },
      { text: 'The Dispatcher',   link: '/examples/the-dispatcher' },
    ],
  },
  {
    text: 'Example Guide',
    collapsed: false,
    items: [
      { text: 'Example 01: Linear Intake',             link: '/examples/01-linear' },
      { text: 'Example 02: DAGBuilder',                link: '/examples/02-builder' },
      { text: 'Example 03: Tool Schemas',              link: '/examples/03-schema' },
      { text: 'Example 04: Scatter Scout',             link: '/examples/04-scatter' },
      { text: 'Example 04B: Scatter Collect',          link: '/examples/04b-scatter-collect' },
      { text: 'Example 04C: Container-Bound Scatter',  link: '/examples/04c-scatter-workers' },
      { text: 'Example 05: Embedded DAGs',             link: '/examples/05-embedded-dags' },
      { text: 'Example 06: Cancellation',              link: '/examples/06-cancellation' },
      { text: 'Example 07: Retry Flow',                link: '/examples/07-retry' },
      { text: 'Example 08: Checkpoint and Resume',     link: '/examples/08-checkpoint' },
      { text: 'Example 09: Terminal Nodes',            link: '/examples/09-terminals' },
      { text: 'Example 10: Shared State',              link: '/examples/10-shared-state' },
      { text: 'Example 11: Operator Hand-Off',         link: '/examples/11-handoff' },
      { text: 'Example 12: Worker Containers',         link: '/examples/12-workers' },
      { text: 'Example 13: Multi-Backend Roles',       link: '/examples/13-multibackend' },
      { text: 'Example 14: Gather Strategies',         link: '/examples/14-gather-strategies' },
      { text: 'Example 15: Incremental Gather',        link: '/examples/15-incremental-gather' },
      { text: 'Example 16: Scatter Resume',            link: '/examples/16-scatter-resume' },
      { text: 'Example 17: Async Scatter Source',      link: '/examples/17-scatter-async-source' },
      { text: 'Example 18: Observability',             link: '/examples/18-observability' },
      { text: 'Example 19: Phase Nodes',               link: '/examples/19-phase-nodes' },
      { text: 'Example 20: Streaming Execution',       link: '/examples/20-streaming' },
      { text: 'Example 21: Per-Node Timeout',          link: '/examples/21-per-node-timeout' },
      { text: 'Example 22: Retry Timing and Salvage',  link: '/examples/22-backoff-strategies' },
      { text: 'Example 23: Checkpoint Store',          link: '/examples/23-checkpoint-store' },
      { text: 'Example 24: LLM Adapter',               link: '/examples/24-llm-adapter' },
      { text: 'Example 25: Embedder',                  link: '/examples/25-embedder' },
      { text: 'Example 26: Tool Use',                  link: '/examples/26-tool-use' },
      { text: 'Example 27: Runtime DAG Dispatch',      link: '/examples/27-recursion' },
      { text: 'Example 28: Runner and Triggers',       link: '/examples/28-runner' },
      { text: 'Example 29: Agent DAG with JSON-LD',    link: '/examples/29-agent-dag' },
      { text: 'Example 30: Progress Events',           link: '/examples/30-progress' },
      { text: 'Example 31: HITL Park-and-Correlate', link: '/examples/31-hitl' },
      { text: 'Example 32: Dispatcher CLI',            link: '/examples/32-dispatcher' },
      { text: 'Example 33: Plugin-Defined DAGs',       link: '/examples/33-plugin' },
      { text: 'Example 34: StreamChannel Source',      link: '/examples/34-stream-channel' },
      { text: 'Example 35: Stream Resume Cursor',      link: '/examples/35-stream-fanin-resume' },
      { text: 'Example 36: DAG Stream Producer',       link: '/examples/36-dag-stream-producer' },
    ],
  },
  {
    text: 'Supporting Examples',
    collapsed: true,
    items: [
      { text: 'Constants Usage',             link: '/examples/constants-usage' },
      { text: 'IRI Identity and Prefix Isolation', link: '/examples/iri-identity' },
      { text: 'Monadic Node',                link: '/examples/monadic-node' },
      { text: 'ReAct Agent Memory',          link: '/examples/react-agent-memory' },
      { text: 'ReAct Agent Routing',         link: '/examples/react-agent-routing' },
      { text: 'Remote Store',                link: '/examples/store-remote' },
      { text: 'Scatter Extensions',          link: '/examples/scatter-extensions' },
      { text: 'State Accessor',              link: '/examples/state-accessor' },
      { text: 'Virtual Clock',               link: '/examples/virtual-clock' },
    ],
  },
  {
    // Dependency order: authoring → data model → execution → operations.
    text: 'Guide',
    collapsed: false,
    items: [
      { text: 'Authoring DAGs',            link: '/guide/authoring' },
      { text: 'Subclassing State',         link: '/guide/subclassing' },
      { text: 'DAGBuilder',                link: '/guide/builder' },
      { text: 'JSON-LD Export and Import', link: '/guide/json-ld' },
      { text: 'IRI Identity',              link: '/guide/iri-identity' },
      { text: 'Schema and JSON Loading',   link: '/guide/schema' },
      { text: 'Plural-Native Execution',   link: '/guide/plural-native' },
      { text: 'Migrating to Batch',        link: '/guide/migrating-to-batch' },
      { text: 'Lifecycle Phases',          link: '/guide/lifecycle-phases' },
      { text: 'Dependency Injection',      link: '/guide/services' },
      { text: 'State Accessors',           link: '/guide/state-accessor' },
      { text: 'Shared State',              link: '/guide/shared-state' },
      { text: 'Checkpoint and Resume',     link: '/guide/checkpoint' },
      { text: 'Checkpoint Persistence',    link: '/guide/persistence' },
      { text: 'Cancellation',              link: '/guide/cancellation' },
      { text: 'Retry',                     link: '/guide/retry' },
      { text: 'Execution Tuning',          link: '/guide/execution-tuning' },
      { text: 'Reservoir',                 link: '/guide/reservoir' },
      { text: 'Streaming Producers',       link: '/guide/streaming-producers' },
      { text: 'Observability',             link: '/guide/observability' },
      { text: 'HITL Park-and-Correlate',   link: '/guide/hitl' },
      { text: 'Conversational Agents',     link: '/guide/conversational' },
      { text: 'Chat Event Orchestration',  link: '/guide/chat-event-orchestration' },
      { text: 'ReAct Agent: Streaming and Provenance Recall', link: '/guide/react-agent' },
      { text: 'Visualization',             link: '/guide/visualization' },
      { text: 'Distribution and Cloud',    link: '/guide/distribution' },
    ],
  },
  {
    // Promoted to its own tier; per-plugin pages land here as the registry grows.
    text: 'Plugins',
    collapsed: false,
    items: [
      { text: 'Plugins', link: '/guide/plugins' },
      { text: 'Unified Plugin Embedding Plan', link: '/guide/unified-plugin-embedding-plan' },
    ],
  },
  {
    text: 'Reference',
    collapsed: false,
    items: [
      { text: 'Import Map', link: '/reference/import-map' },
      { text: 'Dagonizer',  link: '/reference/dagonizer' },
      { text: 'Execution',  link: '/reference/execution' },
      { text: 'Runner',     link: '/reference/runner' },
      { text: 'Nodes',      link: '/reference/nodes' },
      { text: 'Lifecycle',  link: '/reference/lifecycle' },
      { text: 'Runtime',    link: '/reference/runtime' },
      { text: 'Contracts',  link: '/reference/contracts' },
      { text: 'Adapters',   link: '/reference/adapters' },
      { text: 'Core',       link: '/reference/core' },
      { text: 'Visualization', link: '/reference/viz' },
      { text: 'Validation', link: '/reference/validation' },
      { text: 'Checkpoint', link: '/reference/checkpoint' },
      { text: 'Store',      link: '/reference/store' },
      { text: 'Entities',   link: '/reference/entities' },
      { text: 'Testing',    link: '/reference/testing' },
      { text: 'Container', link: '/reference/container' },
      { text: 'Channels',  link: '/reference/channels' },
      { text: 'Errors',    link: '/reference/errors' },
    ],
  },
];

// Site identity: single source of truth for SEO, OG, JSON-LD.
const SITE_TITLE = 'Dagonizer';
const SITE_TAGLINE = 'TypeScript framework for orchestrating work as a DAG of typed nodes with a state machine lifecycle';
const SITE_DESCRIPTION = 'Dagonizer is one type-safe DAG engine for both LLM-agent orchestration and data-pipeline / ETL workflows. Features: streaming backpressure, type-safe routing, abortable execution, deterministic resume, embedded-DAG composition, retry policies, JSON-LD wire format, FSM lifecycle, pluggable visualization. No external runtime. Runs in the browser.';
const SITE_DESCRIPTION_SHORT = 'TypeScript DAG orchestration framework. Type-safe nodes, abortable execution, deterministic resume, embedded-DAG composition, FSM lifecycle, no external runtime.';
const SITE_BASE = '/Dagonizer/';
const SITE_URL = `https://studnicky.github.io${SITE_BASE}`;
const SITE_ICON = `${SITE_URL}dagonizer-icon.svg`;
const SITE_OG_IMAGE = `${SITE_URL}og-image.png`;
const SITE_THEME_COLOR = '#22e8ff';
const SITE_KEYWORDS = 'dagonizer, dag, workflow, orchestration, dispatcher, node.js, typescript, flow, pipeline, state-machine, scatter-gather, embedded-dag, checkpoint, abortable, deterministic resume, mermaid visualization, json schema, retry policy, cancellation, async-iterable';
const SITE_AUTHOR_NAME = 'Andrew Studnicky';
const SITE_AUTHOR_URL = 'https://github.com/Studnicky';
const SITE_REPO       = 'https://github.com/Studnicky/Dagonizer';
const SITE_NPM        = 'https://www.npmjs.com/package/@studnicky/dagonizer';
const SITE_LOGO       = `${SITE_URL}dagonizer-icon.svg`;

export default withMermaid(defineConfig({
  title: SITE_TITLE,
  titleTemplate: `:title | ${SITE_TITLE}`,
  description: SITE_DESCRIPTION,
  lang: 'en-US',
  base: SITE_BASE,
  sitemap: { hostname: SITE_URL },
  appearance: false,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    /* Favicon stack. The SVG is the canonical icon (modern browsers,
       crisp at every size). The PNG variants stay as fallbacks for
       crawlers and iOS home-screen / Android-shortcut use cases where
       SVG support is patchy. Order matters: browsers pick the first
       `rel=icon` they can render, so SVG goes first. */
    ['link', { 'rel': 'icon',             'type': 'image/svg+xml',                       'href': `${SITE_BASE}dagonizer-icon.svg` }],
    ['link', { 'rel': 'icon',             'type': 'image/x-icon',                        'href': `${SITE_BASE}favicon.ico` }],
    ['link', { 'rel': 'icon',             'type': 'image/png',   'sizes': '32x32',       'href': `${SITE_BASE}favicon-32.png` }],
    ['link', { 'rel': 'icon',             'type': 'image/png',   'sizes': '192x192',     'href': `${SITE_BASE}favicon-192.png` }],
    ['link', { 'rel': 'shortcut icon',                                                   'href': `${SITE_BASE}favicon.ico` }],
    ['link', { 'rel': 'apple-touch-icon', 'sizes': '180x180',                            'href': `${SITE_BASE}apple-touch-icon.png` }],
    ['link', { 'rel': 'mask-icon',        'color': SITE_THEME_COLOR,                     'href': `${SITE_BASE}dagonizer-icon.svg` }],
    ['link', { 'rel': 'manifest',                                                        'href': `${SITE_BASE}manifest.webmanifest` }],
    ['link', { 'rel': 'sitemap',          'type': 'application/xml',                     'href': `${SITE_BASE}sitemap.xml` }],
    ['link', { 'rel': 'alternate',        'type': 'application/rss+xml', 'title': `${SITE_TITLE}: changelog`, 'href': `${SITE_BASE}feed.xml` }],

    /* Cross-origin preconnect / dns-prefetch. The browser opens TCP +
       TLS to these hosts during HTML parsing, shaving ~100-300ms off
       the first font / WebLLM chunk download. Google grades this as a
       Core Web Vitals signal: LCP improves when third-party resources
       resolve faster. `dns-prefetch` is a no-op when `preconnect`
       already fired but stays as a fallback for browsers that ignore
       preconnect (older Safari). esm.run hosts the WebLLM MLC bundle
       (~700 MB lazy-loaded by the in-browser LLM backend). */
    ['link', { 'rel': 'preconnect',   'href': 'https://fonts.googleapis.com' }],
    ['link', { 'rel': 'preconnect',   'href': 'https://fonts.gstatic.com', 'crossorigin': '' }],
    ['link', { 'rel': 'preconnect',   'href': 'https://esm.run', 'crossorigin': '' }],
    ['link', { 'rel': 'dns-prefetch', 'href': 'https://fonts.googleapis.com' }],
    ['link', { 'rel': 'dns-prefetch', 'href': 'https://esm.run' }],
    ['link', {
      'rel': 'stylesheet',
      'href': 'https://fonts.googleapis.com/css2?family=Caudex:ital,wght@0,400;0,700;1,400;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=JetBrains+Mono:wght@400;500&display=swap',
    }],

    /* `hreflang` declares this is the en-US canonical of the site. With
       only one language variant published, `x-default` points at the
       same URL: harmless duplication that disambiguates intent for
       international search engines and avoids "language not declared"
       webmaster-tools warnings. */
    ['link', { 'rel': 'alternate', 'hreflang': 'en-US',     'href': SITE_URL }],
    ['link', { 'rel': 'alternate', 'hreflang': 'x-default', 'href': SITE_URL }],

    // ── Mobile / browser chrome
    ['meta', { 'name': 'theme-color',                                'content': SITE_THEME_COLOR }],
    ['meta', { 'name': 'color-scheme',                               'content': 'dark light' }],
    ['meta', { 'name': 'msapplication-TileColor',                    'content': SITE_THEME_COLOR }],
    ['meta', { 'name': 'msapplication-TileImage',                    'content': `${SITE_BASE}dagonizer-icon-512.png` }],
    ['meta', { 'name': 'apple-mobile-web-app-capable',               'content': 'yes' }],
    ['meta', { 'name': 'apple-mobile-web-app-title',                 'content': SITE_TITLE }],
    ['meta', { 'name': 'apple-mobile-web-app-status-bar-style',      'content': 'black-translucent' }],

    /* SEO basics. `robots` carries the explicit indexable signal plus
       the modern hints (`max-snippet:-1`, `max-image-preview:large`,
       `max-video-preview:-1`) that surface richer search-result cards.
       `author` and `keywords` carry minor SEO weight; mostly there for
       human-readable previews and competitor-alias discovery. */
    ['meta', { 'name': 'robots',           'content': 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' }],
    ['meta', { 'name': 'googlebot',        'content': 'index, follow' }],
    ['meta', { 'name': 'bingbot',          'content': 'index, follow' }],
    ['meta', { 'name': 'author',           'content': SITE_AUTHOR_NAME }],
    ['meta', { 'name': 'keywords',         'content': SITE_KEYWORDS }],
    ['meta', { 'name': 'description',      'content': SITE_DESCRIPTION }],
    ['meta', { 'name': 'application-name', 'content': SITE_TITLE }],
    ['meta', { 'name': 'generator',        'content': 'VitePress' }],
    /* `referrer` policy. `origin-when-cross-origin` strips the path on
       outbound clicks so external sites only see the hostname in their
       analytics, not the specific docs page. */
    ['meta', { 'name': 'referrer',         'content': 'origin-when-cross-origin' }],

    /* Search-console verification meta tags. Empty content suppresses
       the tag at build time. Add values to package.json `dagonizer.seo.*`
       to enable. We don't ship orphan tags pointing at unowned properties. */
    ...(VERIFY_GOOGLE !== '' ? [['meta', { 'name': 'google-site-verification', 'content': VERIFY_GOOGLE }] as [string, Record<string, string>]] : []),
    ...(VERIFY_BING   !== '' ? [['meta', { 'name': 'msvalidate.01',            'content': VERIFY_BING   }] as [string, Record<string, string>]] : []),

    /* Open Graph + Twitter: drive the unfurl card that Discord, Slack,
       iMessage, Twitter/X, and LinkedIn render when someone pastes the
       URL. `og:image` MUST be an absolute URL. Per-page values are
       overridden via `transformPageData` below; these are the defaults. */
    ['meta', { 'property': 'og:type',             'content': 'website' }],
    ['meta', { 'property': 'og:site_name',        'content': SITE_TITLE }],
    ['meta', { 'property': 'og:title',            'content': `${SITE_TITLE}: ${SITE_TAGLINE}` }],
    ['meta', { 'property': 'og:description',      'content': SITE_DESCRIPTION }],
    ['meta', { 'property': 'og:url',              'content': SITE_URL }],
    ['meta', { 'property': 'og:image',            'content': SITE_OG_IMAGE }],
    ['meta', { 'property': 'og:image:secure_url', 'content': SITE_OG_IMAGE }],
    ['meta', { 'property': 'og:image:type',       'content': 'image/png' }],
    ['meta', { 'property': 'og:image:alt',        'content': `${SITE_TITLE}: ${SITE_TAGLINE}` }],
    ['meta', { 'property': 'og:image:width',      'content': '1200' }],
    ['meta', { 'property': 'og:image:height',     'content': '630' }],
    ['meta', { 'property': 'og:locale',           'content': 'en_US' }],
    ['meta', { 'name':     'twitter:card',        'content': 'summary_large_image' }],
    ['meta', { 'name':     'twitter:title',       'content': `${SITE_TITLE}: ${SITE_TAGLINE}` }],
    ['meta', { 'name':     'twitter:description', 'content': SITE_DESCRIPTION_SHORT }],
    ['meta', { 'name':     'twitter:image',       'content': SITE_OG_IMAGE }],
    ['meta', { 'name':     'twitter:image:alt',   'content': `${SITE_TITLE}: ${SITE_TAGLINE}` }],
    ...(SITE_TWITTER_HANDLE !== '' ? [
      ['meta', { 'name': 'twitter:site',    'content': SITE_TWITTER_HANDLE }] as HeadConfig,
      ['meta', { 'name': 'twitter:creator', 'content': SITE_TWITTER_HANDLE }] as HeadConfig,
    ] : []),

    /* JSON-LD structured data. Search engines parse this into a rich
       site card (name, description, author, repository) and link the
       resulting result to schema.org's SoftwareSourceCode + WebSite
       types so the site shows up in code-search and tooling organic
       results. */
    ['script', { 'type': 'application/ld+json' }, JSON.stringify({
      '@context':            'https://schema.org',
      '@type':               'SoftwareSourceCode',
      'name':                SITE_TITLE,
      'description':         SITE_DESCRIPTION,
      'url':                 SITE_URL,
      'codeRepository':      SITE_REPO,
      'programmingLanguage': 'TypeScript',
      'runtimePlatform':     'Node.js >=24',
      'license':             'https://opensource.org/licenses/MIT',
      'image':               SITE_OG_IMAGE,
      'author': {
        '@type': 'Person',
        'name':  SITE_AUTHOR_NAME,
        'url':   SITE_AUTHOR_URL,
      },
      'keywords': SITE_KEYWORDS,
    })],
    ['script', { 'type': 'application/ld+json' }, JSON.stringify({
      '@context':    'https://schema.org',
      '@type':       'WebSite',
      'name':        SITE_TITLE,
      'url':         SITE_URL,
      'description': SITE_DESCRIPTION,
      'inLanguage':  'en-US',
    })],
    /* Organization schema powers the Google Knowledge Panel. `sameAs`
       lists the canonical accounts that represent this organization
       across the web (GitHub repo, npm registry) so search engines
       can disambiguate `Dagonizer` from unrelated brands. */
    ['script', { 'type': 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type':    'Organization',
      'name':     SITE_TITLE,
      'url':      SITE_URL,
      'logo':     SITE_LOGO,
      'sameAs':   [SITE_REPO, SITE_NPM, SITE_AUTHOR_URL],
      'founder': {
        '@type': 'Person',
        'name':  SITE_AUTHOR_NAME,
        'url':   SITE_AUTHOR_URL,
      },
    })],
  ],
  /**
   * Per-page metadata. VitePress invokes this for every page during the
   * SSR pass; we use it to emit page-specific og:title / og:description /
   * og:url / canonical / twitter:title so social unfurls and SEO results
   * surface the page's own title and the page's own URL rather than the
   * site-level default. Without this, every Discord paste of any page
   * would show the Dagonizer homepage card.
   */
  transformPageData(pageData): void {
    const relPath = pageData.relativePath
      .replace(/\.md$/, '')
      .replace(/(^|\/)index$/, '');
    const pageUrl = relPath === '' ? SITE_URL : `${SITE_URL}${relPath}`;
    /* VitePress sets `pageData.title` from the first H1 when no frontmatter
       title is present, and `pageData.description = ''` (empty string, not
       `undefined`) when no description is supplied. We OR-coalesce so empty
       strings fall through to the site-level defaults; ??-coalescing would
       leak empty `''` into `og:description` / `twitter:description`. */
    const fmTitle       = pageData.frontmatter['title'] as string | undefined;
    const fmDescription = pageData.frontmatter['description'] as string | undefined;
    const title         = fmTitle       || pageData.title       || SITE_TITLE;
    const description   = fmDescription || pageData.description || SITE_DESCRIPTION;
    const displayTitle  = title === SITE_TITLE ? SITE_TITLE : `${title} | ${SITE_TITLE}`;

    /* Force VitePress's `<title>` resolution to honour the frontmatter
       title over a content-derived H1. */
    if (fmTitle !== undefined) pageData.title = fmTitle;
    /* Suppress the `:title | Dagonizer` template on any page whose title is
       already the site title. Without this the home renders as
       `Dagonizer | Dagonizer`. VitePress reads `pageData.titleTemplate`
       (top-level, not under frontmatter) when composing the `<title>`
       element; `false` skips template expansion and yields the bare title. */
    if (title === SITE_TITLE) {
      (pageData as { titleTemplate?: string | false }).titleTemplate = false;
    }

    /* BreadcrumbList structured data. Google renders this as the
       "Home > Section > Page" trail above the SERP result, replacing
       the bare URL. Built from URL segments: root is always "Dagonizer";
       each path segment becomes a position with a humanised label and
       its absolute URL. Schema.org spec: every list item carries its
       absolute `item` URL plus a sequential `position`. */
    const segments = relPath === '' ? [] : relPath.split('/');
    const crumbs: Array<{ '@type': 'ListItem'; 'position': number; 'name': string; 'item': string }> = [
      { '@type': 'ListItem', 'position': 1, 'name': SITE_TITLE, 'item': SITE_URL },
    ];
    let accumulated = '';
    for (let i = 0; i < segments.length; i++) {
      const seg    = segments[i] as string;
      accumulated  = accumulated === '' ? seg : `${accumulated}/${seg}`;
      const isLast = i === segments.length - 1;
      const label  = isLast
        ? title
        : seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      crumbs.push({
        '@type':    'ListItem',
        'position': i + 2,
        'name':     label,
        'item':     `${SITE_URL}${accumulated}`,
      });
    }
    const breadcrumb = {
      '@context':        'https://schema.org',
      '@type':           'BreadcrumbList',
      'itemListElement': crumbs,
    };

    /* Article timestamps when VitePress has resolved a `lastUpdated`
       value from git. `article:modified_time` is the freshness signal
       Google uses to rank time-sensitive content. Uncommitted markdown
       files come back with `lastUpdated === 0` or NaN; guard both to
       avoid `Date(0).toISOString()` polluting the freshness signal with
       1970, and to avoid the constructor throwing on NaN. */
    const lastUpdated = (typeof pageData.lastUpdated === 'number'
      && Number.isFinite(pageData.lastUpdated)
      && pageData.lastUpdated > 0)
      ? new Date(pageData.lastUpdated).toISOString()
      : undefined;

    /* HowTo structured data for /examples/* pages. Each example is a
       procedural guide; the HowTo type powers a step-carousel rich-result
       variant in Google search. We emit a minimal shell (name + URL +
       description + image); per-example `step` arrays would require
       parsing the markdown. The shell alone is enough for Google to
       recognise the page as a HowTo and grant the rich-result eligibility. */
    const isExample = relPath.startsWith('examples/');
    const howto = isExample ? {
      '@context':    'https://schema.org',
      '@type':       'HowTo',
      'name':        displayTitle,
      'description': description,
      'url':         pageUrl,
      'image':       SITE_OG_IMAGE,
    } : undefined;

    pageData.frontmatter['head'] = [
      ...(pageData.frontmatter['head'] as ReadonlyArray<readonly [string, Record<string, string>]> ?? []),
      ['link', { 'rel': 'canonical',               'href': pageUrl }],
      ['meta', { 'property': 'og:url',             'content': pageUrl }],
      ['meta', { 'property': 'og:title',           'content': displayTitle }],
      ['meta', { 'property': 'og:description',     'content': description }],
      ['meta', { 'name':     'twitter:title',       'content': displayTitle }],
      ['meta', { 'name':     'twitter:description', 'content': description }],
      ['meta', { 'name':     'description',         'content': description }],
      ...(lastUpdated !== undefined ? [
        ['meta', { 'property': 'article:modified_time', 'content': lastUpdated }] as const,
        ['meta', { 'property': 'article:author',        'content': SITE_AUTHOR_NAME }] as const,
      ] : []),
      ['script', { 'type': 'application/ld+json' }, JSON.stringify(breadcrumb)],
      ...(howto !== undefined ? [
        ['script', { 'type': 'application/ld+json' }, JSON.stringify(howto)] as const,
      ] : []),
    ];
  },
  /**
   * Build-end hook. Generates the changelog RSS feed by parsing
   * `CHANGELOG.md` once per build and writing `feed.xml` into the
   * VitePress dist root. RSS is still the standard discovery channel
   * for tooling integrators (npm release watchers, GitHub Action
   * notifiers, dependency-update bots); shipping a feed alongside the
   * docs costs almost nothing and gets cited from `<link rel="alternate"
   * type="application/rss+xml">` in the head for in-page auto-discovery.
   */
  buildEnd(siteConfig): void {
    const changelogPath = resolve(siteConfig.root, '..', 'CHANGELOG.md');
    if (!existsSync(changelogPath)) return;
    const md = readFileSync(changelogPath, 'utf-8');
    /* Match `## [version] - YYYY-MM-DD` headings; capture version, date,
       and the body until the next `## ` heading (or EOF). The Keep a
       Changelog format dictates this structure. */
    const re = /## \[([^\]]+)\][^\n]*?-\s*(\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=\n## |\n$)/g;
    interface FeedEntryInterface {
      readonly version: string;
      readonly date:    string;
      readonly body:    string;
    }
    const entries: FeedEntryInterface[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      entries.push({ 'version': m[1] as string, 'date': m[2] as string, 'body': (m[3] ?? '').trim() });
    }
    /* RFC 822 date format is the RSS 2.0 spec requirement. Keep a
       Changelog dates are YYYY-MM-DD; convert via `new Date(...)` at
       UTC noon to avoid timezone-drift backdating. */
    const rfc822 = (isoDate: string): string => new Date(`${isoDate}T12:00:00Z`).toUTCString();
    const escape = (s: string): string => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const items = entries.map((entry) => {
      const url = `${SITE_URL}#${entry.version.toLowerCase()}`;
      return [
        '    <item>',
        `      <title>${escape(SITE_TITLE)} ${escape(entry.version)}</title>`,
        `      <link>${escape(url)}</link>`,
        `      <guid isPermaLink="false">${escape(SITE_URL)}changelog/${escape(entry.version)}</guid>`,
        `      <pubDate>${rfc822(entry.date)}</pubDate>`,
        `      <description><![CDATA[${entry.body}]]></description>`,
        '    </item>',
      ].join('\n');
    }).join('\n');
    const feed = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${escape(SITE_TITLE)}: changelog</title>`,
      `    <link>${escape(SITE_URL)}</link>`,
      `    <description>${escape(SITE_DESCRIPTION)}</description>`,
      '    <language>en-US</language>',
      `    <atom:link href="${escape(SITE_URL)}feed.xml" rel="self" type="application/rss+xml" />`,
      items,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n');
    writeFileSync(resolve(siteConfig.outDir, 'feed.xml'), feed);
  },
  // Syntax highlighting uses VitePress's bundled Shiki themes. `night-owl`
  // is a dark navy-grounded theme that harmonizes with the navy / pearl
  // chrome and the teal / violet / yellow brand orbs used throughout the
  // page. We do NOT ship a custom Shiki theme; the code-block CHROME
  // (background, border, font, padding) is themed via CSS using our
  // palette tokens; the syntax token colors come from a well-tested
  // pre-built theme that already meets contrast guarantees.
  markdown: {
    theme: 'night-owl',
    // Twoslash type-checks fenced blocks against the package at build time.
    // Only blocks tagged ```ts twoslash are processed; plain ```ts is left
    // untouched. A type error in a tagged block fails the docs build, so
    // reference snippets cannot drift from the shipped types. Compiler
    // options mirror docs/tsconfig.json so the package's subpath exports
    // (`@studnicky/dagonizer/contracts`, `/entities`, …) resolve.
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            target: 99,            // ES2022+
            module: 99,            // ESNext
            moduleResolution: 100, // Bundler
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
            types: ['node'],
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            skipLibCheck: true,
          },
        },
      }),
    ],
  },
  mermaid: ({
    // Theme colors are owned by base.css overrides on the rendered SVG so
    // mode switching is instant and consistent across the site. The
    // `themeVariables` here are SSR-time placeholders; the runtime CSS
    // wins. Values mirror the palette tokens from iridis.palette.css so
    // first paint already shows the mechanicus chrome (pearl-black node
    // surface, teal accent border, monospace text on the navy panel).
    theme: 'base',
    // Raise Mermaid's safety caps: a large DAG (hundreds of placements/edges,
    // tens of KB of source) silently blanks on the defaults (maxTextSize 50000,
    // maxEdges 500). NOTE: themeVariables colours are parsed by khroma and MUST
    // be concrete colours — a CSS var() throws and blanks every diagram; theme
    // colours live in base.css/explorer.css on the rendered SVG instead.
    maxTextSize: 200000,
    maxEdges: 5000,
    // System monospace stack ONLY, no web fonts. Mermaid measures label
    // widths at SSR time before any web font loads; if measurement uses the
    // fallback and the render later swaps in a wider web font (JetBrains
    // Mono), labels overflow their rect. SF Mono / Menlo / Consolas are all
    // pre-installed on macOS / Windows / Linux respectively, so measurement
    // and render always use the same metrics.
    fontFamily: 'SF Mono, ui-monospace, Menlo, Consolas, "Liberation Mono", monospace',
    themeVariables: {
      fontFamily: 'SF Mono, ui-monospace, Menlo, Consolas, "Liberation Mono", monospace',
      // Fixed font size applied globally so every diagram type (flowchart,
      // state, sequence) renders nodes at the same typographic scale.
      // Complex diagrams that would otherwise explode in size are handled
      // by the pan/zoom expand modal.
      fontSize: '13px',
      background: 'transparent',
      // Node interior matches the pearl-black code-block surface.
      primaryColor: '#020306',
      // Teal brand accent for default node borders.
      primaryBorderColor: '#22e8ff',
      // Pearl text on pearl-black, high contrast for AAA.
      primaryTextColor: '#eef3f7',
      // Edges use the same teal accent as default node borders.
      lineColor: '#22e8ff',
      arrowheadColor: '#22e8ff',
      // Edge labels sit on the navy panel surface so they pop off the
      // pearl-black diagram interior.
      edgeLabelBackground: '#0e1525',
      // Clusters use the deepest navy with a steel divider edge.
      clusterBkg: '#04060a',
      clusterBorder: '#7a8290',
      titleColor: '#eef3f7',
      // Secondary / tertiary accent slots map to violet / gold so
      // state diagrams and special nodes pick up the right brand orb
      // without further overrides.
      secondaryColor: '#020306',
      secondaryBorderColor: '#8f6dff',
      secondaryTextColor: '#eef3f7',
      tertiaryColor: '#020306',
      tertiaryBorderColor: '#d4a649',
      tertiaryTextColor: '#eef3f7',
    },
    flowchart: {
      curve: 'linear',
      // htmlLabels: true renders labels in <foreignObject> so they
      // wrap on word boundaries instead of overflowing the rect.
      // wrappingWidth must comfortably hold the longest node label
      // we ship: "dispatcher.execute" is 18 chars; "Checkpoint.capture"
      // is 18; 220px at the current 13px monospace fits ~22 chars per
      // line with room to breathe.
      htmlLabels: true,
      wrappingWidth: 220,
      // useMaxWidth: false renders the SVG at its natural width; the
      // frame centers and horizontally scrolls when needed. Using
      // true makes mermaid scale tall TB diagrams uniformly (width +
      // height proportionally), producing 4000px-tall artifacts in a
      // 1280px column when the diagram is naturally narrow.
      useMaxWidth: false,
      nodeSpacing: 60,
      rankSpacing: 70,
      padding: 12,
      diagramPadding: 12,
    },
    stateDiagram: {
      curve: 'linear',
      useMaxWidth: false,
      // Enable htmlLabels so state labels render inside foreignObject
      // and the rect grows to fit the content; otherwise mermaid
      // sizes the rect from a font-measurement that desyncs with the
      // monospace font we override in CSS and labels clip to 6 chars
      // ("pending" → "pendin", "running" → "runnin").
      htmlLabels: true,
    },
    sequence: {
      useMaxWidth: false,
      diagramMarginX: 8,
      diagramMarginY: 8,
    },
  } as unknown as MermaidConfig),
  mermaidPlugin: { class: 'mermaid dagonizer-mermaid' },
  themeConfig: {
    // No logo in the top nav; the icon lives in the sidebar and on the
    // favicon only. Title text alone in the nav keeps it minimal.
    siteTitle: 'Dagonizer',
    search: { provider: 'local' },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/reference/dagonizer' },
      { text: 'Examples', link: '/examples/the-archivist' },
      { text: 'GitHub', link: 'https://github.com/Studnicky/Dagonizer' },
    ],
    sidebar,
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Studnicky/Dagonizer' },
    ],
    footer: {
      copyright: 'MIT License, © 2026 Andrew Studnicky',
      message: 'Watched over by the Order of Dagon.',
    },
    editLink: {
      pattern: 'https://github.com/Studnicky/Dagonizer/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    outline: { label: 'On this page', level: [2, 3] as [number, number] },
    docFooter: { next: 'Next', prev: 'Previous' },
  },
  vite: {
    // Serve (dev) / emit (build) the transformers embedder's vendored model +
    // onnxruntime WASM from the app bundle, so the in-browser vector intent
    // classifier runs fully offline. Exposes `virtual:transformers-embedder-assets`.
    plugins: [transformersEmbedderAssets()],
    // Aliases so the in-browser runners can import the canonical
    // domain files straight from `examples/` and the
    // renderer source from `src/viz/`. Browser bundles use these; the
    // package's own consumers see the published `@studnicky/dagonizer/*`.
    resolve: {
      alias: {
        '@archivist':    ARCHIVIST,
        '@cartographer': CARTOGRAPHER,
        '@dagonizer-viz': VIZ_SRC,
        '@dagonizer-src': REPO_ROOT,
      },
    },
    optimizeDeps: {
      // `yaml`'s browser entry re-exports a CJS core (`export * from
      // './dist/index.js'`); without pre-bundling, the named `stringify`/`parse`
      // imports resolve to `undefined` in the browser. Pre-bundling fixes interop.
      include: ['tz-lookup', '@rapideditor/country-coder', 'yaml'],
    },
    // The base tsconfig targets `ES2024`, which the Vite-bundled esbuild does
    // not accept. Pin a target esbuild supports so the docs bundle transpiles
    // the `src/viz/` and `examples/` sources cleanly (browser runtime only).
    esbuild: {
      target: 'es2022',
    },
  },
}));
