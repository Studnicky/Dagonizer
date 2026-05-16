import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const sidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Concepts', link: '/concepts' },
    ],
  },
  {
    // Order: what a consumer needs to know first → progressively deeper.
    //   1. State + builder — author the things you want to run
    //   2. Schema & JSON loading — load DAGs from outside
    //   3. Cancellation + retry — make running flows survive
    //   4. Services — wire dependencies into nodes
    //   5. Observability — see what's happening
    //   6. State accessors — swap path resolution
    //   7. Checkpoint + persistence — pause and resume
    //   8. Contract-derived flows — generate the topology automatically
    //   9. Visualization — render the result
    text: 'Usage',
    collapsed: false,
    items: [
      { text: 'Subclassing State', link: '/guide/subclassing' },
      { text: 'DAGBuilder', link: '/guide/builder' },
      { text: 'Schema & JSON loading', link: '/guide/schema' },
      { text: 'Cancellation', link: '/guide/cancellation' },
      { text: 'Retry', link: '/guide/retry' },
      { text: 'Services', link: '/guide/services' },
      { text: 'Observability', link: '/guide/observability' },
      { text: 'State accessors', link: '/guide/state-accessor' },
      { text: 'Checkpoint', link: '/guide/checkpoint' },
      { text: 'Persistence', link: '/guide/persistence' },
      { text: 'Contract-derived flows', link: '/guide/derive' },
      { text: 'Visualization', link: '/guide/visualization' },
    ],
  },
  {
    text: 'Reference',
    collapsed: false,
    items: [
      { text: 'Dagonizer', link: '/reference/dagonizer' },
      { text: 'Execution', link: '/reference/execution' },
      { text: 'Operations', link: '/reference/operations' },
      { text: 'Lifecycle', link: '/reference/lifecycle' },
      { text: 'Runtime', link: '/reference/runtime' },
      { text: 'Contracts', link: '/reference/contracts' },
      { text: 'Core', link: '/reference/core' },
      { text: 'Derive', link: '/reference/derive' },
      { text: 'Viz', link: '/reference/viz' },
      { text: 'Validation', link: '/reference/validation' },
      { text: 'Checkpoint', link: '/reference/checkpoint' },
      { text: 'Entities', link: '/reference/entities' },
      { text: 'Testing', link: '/reference/testing' },
      { text: 'Errors', link: '/reference/errors' },
    ],
  },
  {
    text: 'Examples',
    collapsed: false,
    items: [
      { text: 'Linear Flow', link: '/examples/01-linear' },
      { text: 'Fan-Out + Fan-In', link: '/examples/02-fanout' },
      { text: 'Sub-Flows', link: '/examples/03-subflows' },
      { text: 'Cancellation', link: '/examples/04-cancellation' },
      { text: 'Retry', link: '/examples/05-retry' },
      { text: 'FlowBuilder', link: '/examples/06-builder' },
      { text: 'Schema Loading', link: '/examples/07-schema' },
      { text: 'Checkpoint Resume', link: '/examples/08-checkpoint' },
    ],
  },
];

// ── Site identity — single source of truth for SEO, OG, JSON-LD ─────────
const SITE_TITLE = 'Dagonizer';
const SITE_TAGLINE = 'Omniscient orchestration for directed acyclic graphs';
const SITE_DESCRIPTION = 'Dagonizer is a type-safe DAG dispatcher for Node.js — JSON-Schema-validated graph definitions, abortable execution, deterministic resume, pluggable combiners and fan-in strategies, contract-derived flow generation, and Mermaid visualization.';
const SITE_DESCRIPTION_SHORT = 'Type-safe DAG dispatcher for Node.js. Abortable execution, deterministic resume, pluggable strategies, contract-derived flows, Mermaid visualization.';
const SITE_BASE = '/Dagonizer/';
const SITE_URL = `https://studnicky.github.io${SITE_BASE}`;
const SITE_ICON = `${SITE_URL}dagonizer-icon.svg`;
const SITE_OG_IMAGE = `${SITE_URL}og-image.png`;
const SITE_THEME_COLOR = '#22e8ff';
const SITE_KEYWORDS = 'dagonizer, dag, workflow, orchestration, dispatcher, node.js, typescript, flow, pipeline, state-machine, fan-out, fan-in, sub-dag, parallel, checkpoint, abortable, deterministic resume, mermaid visualization, json schema, retry policy, cancellation, async-iterable, contract-derived flow';
const SITE_AUTHOR_NAME = 'Andrew Studnicky';
const SITE_AUTHOR_URL = 'https://github.com/Studnicky';
const SITE_REPO = 'https://github.com/Studnicky/Dagonizer';

export default withMermaid(defineConfig({
  title: SITE_TITLE,
  titleTemplate: `:title | ${SITE_TITLE}`,
  description: SITE_DESCRIPTION,
  lang: 'en-US',
  base: SITE_BASE,
  sitemap: { hostname: SITE_URL },
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    // ── Favicon stack — SVG for modern browsers, raster fallbacks for legacy
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${SITE_BASE}dagonizer-icon.svg` }],
    ['link', { rel: 'icon', type: 'image/x-icon', href: `${SITE_BASE}favicon.ico` }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${SITE_BASE}favicon-32.png` }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '192x192', href: `${SITE_BASE}favicon-192.png` }],
    ['link', { rel: 'shortcut icon', href: `${SITE_BASE}favicon.ico` }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: `${SITE_BASE}apple-touch-icon.png` }],
    ['link', { rel: 'mask-icon', href: `${SITE_BASE}dagonizer-icon.svg`, color: SITE_THEME_COLOR }],

    // ── Mobile / browser chrome
    ['meta', { name: 'theme-color', content: SITE_THEME_COLOR }],
    ['meta', { name: 'color-scheme', content: 'dark light' }],
    ['meta', { name: 'msapplication-TileColor', content: SITE_THEME_COLOR }],
    ['meta', { name: 'msapplication-TileImage', content: `${SITE_BASE}dagonizer-icon-512.png` }],
    ['meta', { name: 'application-name', content: SITE_TITLE }],
    ['meta', { name: 'apple-mobile-web-app-title', content: SITE_TITLE }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],

    // ── SEO basics
    ['meta', { name: 'description', content: SITE_DESCRIPTION }],
    ['meta', { name: 'keywords', content: SITE_KEYWORDS }],
    ['meta', { name: 'author', content: SITE_AUTHOR_NAME }],
    ['meta', { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' }],
    ['meta', { name: 'googlebot', content: 'index, follow' }],
    ['meta', { name: 'generator', content: 'VitePress' }],
    ['link', { rel: 'sitemap', type: 'application/xml', href: `${SITE_BASE}sitemap.xml` }],

    // ── Open Graph — per-page overrides applied in transformPageData
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:title', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { property: 'og:image', content: SITE_OG_IMAGE }],
    ['meta', { property: 'og:image:secure_url', content: SITE_OG_IMAGE }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],
    ['meta', { property: 'og:locale', content: 'en_US' }],

    // ── Twitter Card — per-page overrides applied in transformPageData
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],
    ['meta', { name: 'twitter:description', content: SITE_DESCRIPTION_SHORT }],
    ['meta', { name: 'twitter:image', content: SITE_OG_IMAGE }],
    ['meta', { name: 'twitter:image:alt', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],

    // ── JSON-LD: SoftwareSourceCode for code-discovery results
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      'name': SITE_TITLE,
      'description': SITE_DESCRIPTION,
      'url': SITE_URL,
      'codeRepository': SITE_REPO,
      'programmingLanguage': 'TypeScript',
      'runtimePlatform': 'Node.js >=24',
      'license': 'https://opensource.org/licenses/MIT',
      'image': SITE_OG_IMAGE,
      'author': {
        '@type': 'Person',
        'name': SITE_AUTHOR_NAME,
        'url': SITE_AUTHOR_URL,
      },
      'keywords': SITE_KEYWORDS,
    })],

    // ── JSON-LD: WebSite for site-card results
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      'name': SITE_TITLE,
      'url': SITE_URL,
      'description': SITE_DESCRIPTION,
      'inLanguage': 'en-US',
    })],

    // ── Google Fonts — Caudex (body) + Share Tech Mono (code)
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Caudex:ital,wght@0,400;0,700;1,400;1,700&family=Share+Tech+Mono&display=swap',
    }],
  ],
  /**
   * Per-page metadata. Emits page-specific og:url / og:title /
   * og:description / twitter:title / twitter:description / canonical so
   * social unfurls and SEO results surface the page's own title and URL
   * rather than the site-level default. Without this, every Discord
   * paste of any page would show the homepage card.
   */
  transformPageData(pageData): void {
    const relPath = pageData.relativePath
      .replace(/\.md$/, '')
      .replace(/(^|\/)index$/, '');
    const pageUrl = relPath === '' ? SITE_URL : `${SITE_URL}${relPath}`;
    const fmTitle = pageData.frontmatter['title'] as string | undefined;
    const fmDescription = pageData.frontmatter['description'] as string | undefined;
    const title = fmTitle ?? pageData.title ?? SITE_TITLE;
    const description = fmDescription ?? pageData.description ?? SITE_DESCRIPTION;
    const displayTitle = title === SITE_TITLE ? SITE_TITLE : `${title} | ${SITE_TITLE}`;

    pageData.frontmatter['head'] = [
      ...(pageData.frontmatter['head'] as ReadonlyArray<readonly [string, Record<string, string>]> ?? []),
      ['link', { rel: 'canonical', href: pageUrl }],
      ['meta', { property: 'og:url', content: pageUrl }],
      ['meta', { property: 'og:title', content: displayTitle }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { name: 'twitter:title', content: displayTitle }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'description', content: description }],
    ];
  },
  markdown: {
    theme: {
      light: 'github-light',
      dark: {
        name: 'dagonizer-dark',
        type: 'dark',
        settings: [
          { settings: { background: '#0a0e1a', foreground: '#c9d0d8' } },
          { scope: ['comment', 'punctuation.definition.comment'],
            settings: { foreground: '#5a6070', fontStyle: 'italic' } },
          { scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator.new'],
            settings: { foreground: '#b18cff' } },
          { scope: ['string', 'string.quoted', 'string.template'],
            settings: { foreground: '#22e8ff' } },
          { scope: ['constant.numeric', 'constant.language.boolean', 'constant.language.null'],
            settings: { foreground: '#d4a649' } },
          { scope: ['entity.name.function', 'support.function', 'meta.function-call'],
            settings: { foreground: '#22e8ff' } },
          { scope: ['entity.name.class', 'entity.name.type', 'support.class', 'support.type'],
            settings: { foreground: '#22e8ff', fontStyle: 'italic' } },
          { scope: ['variable.parameter', 'variable.other.readwrite'],
            settings: { foreground: '#c9d0d8' } },
          { scope: ['variable.other.property', 'meta.object.member'],
            settings: { foreground: '#c9d0d8' } },
          { scope: ['punctuation', 'meta.brace'],
            settings: { foreground: '#8990a0' } },
          { scope: ['entity.name.tag', 'meta.tag'],
            settings: { foreground: '#22e8ff' } },
          { scope: ['entity.other.attribute-name'],
            settings: { foreground: '#d4a649' } },
          { scope: ['constant.language', 'support.constant'],
            settings: { foreground: '#d4a649' } },
          { scope: ['markup.heading'],
            settings: { foreground: '#22e8ff', fontStyle: 'bold' } },
          { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
          { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
        ],
      },
    },
  },
  mermaid: {
    // Theme colors are owned by base.css overrides on the rendered SVG so
    // dark/light mode switching is instant and consistent across the site.
    // The `themeVariables` here are SSR-time placeholders — the runtime CSS
    // wins. Keep them visible (mid-tone neutrals) for first paint.
    theme: 'base',
    fontFamily: 'inherit',
    themeVariables: {
      fontFamily: 'inherit',
      background: 'transparent',
      primaryColor: '#ffffff',
      primaryBorderColor: '#22e8ff',
      primaryTextColor: '#0f1620',
      lineColor: '#22e8ff',
      arrowheadColor: '#22e8ff',
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#e7ecf2',
      clusterBorder: '#aab4c0',
      titleColor: '#0f1620',
    },
    flowchart: {
      // `linear` produces straight angled (hex-style) edge segments —
      // not the default curved Bezier and not 90° step routes.
      curve: 'linear',
      htmlLabels: true,
      useMaxWidth: true,
      padding: 16,
      diagramPadding: 8,
    },
    stateDiagram: {
      curve: 'linear',
      useMaxWidth: true,
    },
  },
  mermaidPlugin: { class: 'mermaid dagonizer-mermaid' },
  themeConfig: {
    // No logo in the top nav — the icon lives in the sidebar and on the
    // favicon only. Title text alone in the nav keeps it minimal.
    siteTitle: 'Dagonizer',
    search: { provider: 'local' },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/reference/dagonizer' },
      { text: 'Examples', link: '/examples/01-linear' },
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
}));
