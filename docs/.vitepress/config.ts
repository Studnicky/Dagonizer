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
const SITE_OG_IMAGE = SITE_ICON;
const SITE_THEME_COLOR = '#0e1525';
const SITE_KEYWORDS = 'dagonizer, dag, workflow, orchestration, dispatcher, node.js, typescript, flow, pipeline, state-machine, fan-out, fan-in, sub-dag, parallel, checkpoint, abortable, deterministic resume, mermaid visualization, json schema, retry policy, cancellation, async-iterable, contract-derived flow';
const SITE_AUTHOR_NAME = 'Andrew Studnicky';
const SITE_AUTHOR_URL = 'https://github.com/Studnicky';
const SITE_REPO = 'https://github.com/Studnicky/Dagonizer';

export default withMermaid(defineConfig({
  title: SITE_TITLE,
  titleTemplate: `:title | ${SITE_TITLE}`,
  description: SITE_DESCRIPTION,
  sitemap: { hostname: SITE_URL },
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    // ── Favicon — the talisman, served as SVG with a 32x32 fallback
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/dagonizer-icon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/dagonizer-icon.svg' }],
    ['link', { rel: 'mask-icon', href: '/dagonizer-icon.svg', color: '#22e8ff' }],

    // ── Canonical + robots
    ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }],
    ['meta', { name: 'author', content: 'Andrew Studnicky' }],
    ['meta', { name: 'keywords', content: SITE_KEYWORDS }],
    ['meta', { name: 'theme-color', content: '#0e1525' }],
    ['meta', { name: 'color-scheme', content: 'dark light' }],
    ['meta', { name: 'application-name', content: SITE_TITLE }],

    // ── Open Graph (Facebook, Slack, Discord, LinkedIn, etc.)
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { property: 'og:title', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    ['meta', { property: 'og:image', content: SITE_ICON }],
    ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
    ['meta', { property: 'og:image:width', content: '1190' }],
    ['meta', { property: 'og:image:height', content: '1190' }],
    ['meta', { property: 'og:image:alt', content: 'Dagonizer hexagonal talisman icon' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],

    // ── Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: `${SITE_TITLE} — ${SITE_TAGLINE}` }],
    ['meta', { name: 'twitter:description', content: SITE_DESCRIPTION }],
    ['meta', { name: 'twitter:image', content: SITE_ICON }],
    ['meta', { name: 'twitter:image:alt', content: 'Dagonizer hexagonal talisman icon' }],

    // ── Schema.org JSON-LD (SoftwareSourceCode for organic-discovery indexing)
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      'name': SITE_TITLE,
      'description': SITE_DESCRIPTION,
      'url': SITE_URL,
      'codeRepository': 'https://github.com/Studnicky/Dagonizer',
      'programmingLanguage': 'TypeScript',
      'runtimePlatform': 'Node.js >=24',
      'license': 'https://opensource.org/licenses/MIT',
      'author': { '@type': 'Person', 'name': 'Andrew Studnicky' },
      'keywords': SITE_KEYWORDS,
      'image': SITE_ICON,
    })],

    // ── Google Fonts — Caudex (body) + Share Tech Mono (code)
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Caudex:ital,wght@0,400;0,700;1,400;1,700&family=Share+Tech+Mono&display=swap',
    }],
  ],
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
