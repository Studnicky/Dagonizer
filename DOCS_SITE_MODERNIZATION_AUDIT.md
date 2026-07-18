# Dagonizer site modernization audit

## Decision summary

### Current implementation status

This document began as a migration audit while the published site was still the
VitePress implementation. The repository state is now materially different:

- the Astro site exists under `site/` and builds successfully;
- the Astro route tree covers the product landing pages, docs index routes, and
  runnable example shells;
- the Astro content pipeline renders the documentation corpus directly from
  `docs/`;
- generic interaction surfaces have been moved onto PrimeVue-backed Vue islands;
- repeated marketing/docs shells have been consolidated into shared Astro and
  Vue primitives.

So this is no longer only a proposal document. It now serves two purposes:

1. explain why the migration was necessary; and
2. record what remains before the cut-over can be considered fully verified.

### Remaining blocker

Rendered browser QA has run against the Astro site and found and fixed three
real defects that static build checks did not catch:

- **Top-nav layout collapse**: the desktop `Menubar`'s `rootlist` had no
  passthrough class in `site/src/primevue-app.ts`, so it fell back to default
  browser `<ul>`/`<li>` block styling. Nav links rendered as a vertical stack
  that overlapped the hero and, while sticky, overlapped page content on
  scroll at every route. Fixed by adding `rootList`/`item`/`submenu`
  passthrough classes.
- **Duplicate hero visual panel**: `UiHeroShell.vue` rendered the `#visual`
  slot twice — once in an `md:block` absolute wrapper and once in an
  `xl:block` grid wrapper, intended as responsive alternates. The `md:block`
  wrapper had no `xl:hidden` upper bound, so both copies rendered
  simultaneously at desktop widths ≥1280px, producing visibly duplicated
  "Inspect" cards. Fixed by adding `xl:hidden` to the `md:block` wrapper.
- **Hero text/visual overlap at tablet width**: with the duplicate-panel fix
  in place, the remaining single `md:block` visual panel (absolutely
  positioned, `right-0 w-[44%]`) overlapped the hero headline at `md`–`lg`
  widths because the text column didn't reserve space for it. Fixed by adding
  `md:pr-[48%] xl:pr-0` to the text column.

Browser QA also found that the production build (`pnpm site:build`) was
currently broken, unrelated to the above: a same-branch WIP refactor of
`packages/dagonizer/src/viz/*` (CameraControls, InspectSelection,
InspectorTarget, SelectionController, ViewerActions, ViewportStatus) to the
project's `noun.verb()` static-class convention had not propagated to every
consumer. `examples/the-archivist/app/ArchivistRunner.vue`,
`docs/.vitepress/theme/components/DagGraph.vue`, `MemoryGraph.vue`, and
`DiagramFrame.vue` still imported the old freestanding function names
(`selectedInspectTarget`, `selectedToolName`, `createCameraDpadMachine`,
`createViewportStatus`, `dagNodeSelection`, `iriSelection`,
`literalSelection`, `viewerAction`). Fixed by updating every consumer to the
new static-class call sites (`SelectionTargets.inspect()`,
`CameraControls.dpadMachine()`, `ViewportStatus.current()`,
`InspectSelection.dagNode()/iri()/literal()`, `ViewerActions.action()`), and
renaming the colliding local `ViewerActions.vue` component import to
`ViewerActionsBar` in `DiagramFrame.vue` and `MemoryGraph.vue` where it
collided with the newly-imported `ViewerActions` class.

Browser QA also found the production build blocked a second time by three
`docs/examples/*.md` pages (`the-cartographer.md`, `34-stream-channel.md`,
`35-stream-fanin-resume.md`, plus a stale mention in
`17-scatter-async-source.md`) snippet-including
`examples/the-cartographer/core/CanonicalFeedGather.ts`, deleted on this
branch as part of an in-progress Cartographer core redesign. The redesign
replaces the `canonical-feed` gather/`canonicalEvents` array with a
`source-intake` gather merging into `state['source-payload']`, and replaces
the direct `event-pipeline-typed` scatter target with a `stream-event` DAG
(`decode-payload → route-event-type-variant → 5 typed pipeline embeds`);
`event-pipeline-typed` remains registered only as a compatibility path. Fixed
by retargeting the snippet includes to `SourceIntakeGather.ts`, rewriting the
affected architecture diagram/prose to match the current topology, and
correcting `examples/the-cartographer/dag.ts`'s own top-of-file JSDoc, which
was itself stale relative to its implementation. Verified by running the live
Cartographer demo end-to-end in a production preview build (100 synthetic
events, GDPR redaction visible in the stream, zero console errors).

`pnpm site:build` now completes clean at 112 pages, and all of the above is
verified against both the Astro dev server and a production `astro preview`
build.

Not yet covered by this pass and still open:

- keyboard-only navigation through the shell;
- local docs search interaction;
- a live demo route boot with worker/model asset network verification;
- reduced-motion behavior;
- a systemic, non-visual PrimeVue SSR/CSR icon-size hydration mismatch
  (`width`/`height` 14 vs 20 across `Chevron*`/`Bars` icons site-wide) —
  Vue reports this as check-only and does not rectify the DOM in production,
  so it carries no observed visual or functional impact, but the root cause
  is unresolved.

The current site uses VitePress because it began as a documentation-first static site: Markdown pages, Vue-enhanced examples, local search, Mermaid, and GitHub Pages output. It now does three jobs at once:

1. documentation and API reference;
2. a technical product/marketing site with a distinctive shell; and
3. several browser applications with workers, Cytoscape, LLM providers, state, persistence, and streaming UI.

That explains why modernization feels difficult. VitePress supplies the content pipeline and Vue SSR/SSG, but the marketing shell is implemented as theme overrides and global CSS around a documentation layout. The demos are registered globally and loaded conditionally inside the same theme.

### Recommendation

Use the Astro site under `site/` as the product/docs shell and continue keeping
generic controls on PrimeVue-backed Vue islands while preserving
Dagonizer-specific runtime and visualization surfaces as repository-owned
components.

Use PrimeVue selectively for application-grade controls and data views. Keep
the marketing shell in repository-owned Astro/CSS primitives. Use external
templates only as references for proven patterns, not as the site itself.

### What is complete in the repository

- Astro product shell routes exist for `/`, `/getting-started`, `/concepts`,
  `/architecture`, and `/docs`.
- Astro docs routes exist for guide, reference, internal, experiments, and
  examples indexes.
- Runnable example pages for Archivist, Dispatcher, and Cartographer use a
  shared Astro shell instead of duplicated page chrome.
- Docs/example/guide/reference landing pages use shared page-header, link-list,
  section-intro, and aside-card primitives.
- PrimeVue-backed surfaces now cover the shared generic controls: buttons,
  menubar, mobile drawer/menu, tags, cards, tabs, selects, inputs, textarea,
  breadcrumb.
- Source-level VitePress coupling has been removed from the Astro docs content
  path and neutralized behind `docs/exampleDags.ts`.
- Current Astro builds emit 112 static pages with clean route/fragment audits.

### What still remains before the cut-over can be called complete

- Top bar/nav rendering, the hero duplicate-panel overlap, and the
  tablet-width text/visual overlap are verified fixed against both the Astro
  dev server and a production `astro preview` build.
- Keyboard-only navigation, local docs search interaction, a live demo route
  boot with worker/model asset verification, and reduced-motion behavior
  still need a browser QA pass.
- A systemic, non-visual PrimeVue SSR/CSR icon-size hydration mismatch
  remains unresolved (see "Remaining blocker" above); it currently carries no
  observed visual or functional impact.
- Only after the remaining browser checks above should the old VitePress site
  be treated as fully superseded.

## Why VitePress is in the repository

VitePress is a Vue-powered static documentation generator. Here it provides:

- Markdown-to-HTML generation for the public documentation corpus.
- Vue SSR/SSG for initial HTML and Vue hydration for interactive blocks.
- Navigation, sidebar, outline, local search, edit links, previous/next navigation, code highlighting, and metadata.
- A straightforward GitHub Pages deployment model under /Dagonizer/.
- A theme extension point for custom Vue components.

The configuration is far beyond a stock theme. It owns the global shell, metadata, syntax highlighting, Mermaid, palette, Vite aliases, embedded assets, and async component registration in the VitePress config and theme index.

VitePress remains a reasonable docs generator. It is not a good long-term composition layer for a product site whose differentiators are art direction, navigation choreography, scroll-led sections, galleries, and interactive demos.

## Current site inventory

### Content

The repository currently contains 102 published Markdown pages under `docs/` once `.vitepress` internals and nested `.orchestration` artifacts are excluded, and the current build emits a much larger public contract than those page files alone suggest.

| Surface | Role | Source |
|---|---|---|
| Home | product positioning, feature grid, calls to action | docs/index.md |
| Getting started and concepts | onboarding and conceptual model | docs/getting-started.md, docs/concepts.md |
| Guides | task-oriented implementation explanations | docs/guide/ |
| Examples | numbered, source-backed behavior demonstrations | docs/examples/ |
| Reference | API and contract documentation | docs/reference/ |
| Architecture | system model and structural explanation | docs/architecture.md |
| Experiment | current visual concept route | docs/experiments/modern-home.md |

The content is structured well for migration. The main risk is preserving navigation taxonomy, links, frontmatter, snippet includes, diagrams, feeds, local search, and page-specific SEO while changing the rendering shell.

### Frontmatter and authoring contract

The Markdown corpus is not generic prose. The current theme and build expect specific authoring patterns:

- `hero` on the home route and the experiment route drives the product hero rendering instead of the stock VitePress home layout.
- `seeAlso` and `nextSteps` arrays drive the custom doc footer and related-navigation blocks.
- `title` and `description` frontmatter are treated as SEO inputs, not only page chrome.
- `<<< ../../path/to/source.ts` snippet embeds make source-backed examples part of the docs contract.
- `<ClientOnly>` wrappers and globally registered async Vue components allow Markdown pages to host live applications.

Any replacement must preserve those authoring ergonomics or provide an explicit codemod path. A migration that keeps the prose but drops snippet includes, related links, or interactive embeds is incomplete.

### Navigation and shell

The global shell is split across:

- the VitePress config, which owns identity, metadata, nav, sidebar, search, Mermaid, aliases, and build behavior;
- the theme index, which extends the default layout and fills layout slots;
- TopBar.vue, which owns top bar, sidebar toggle, brand treatment, responsive state, and experimental visual mode;
- base.css and generated palette CSS, which override much of the default visual system;
- HomeHero.vue and DocFooter.vue, which turn frontmatter into product-specific blocks.

This is the central finding: the brand shell is already a custom application layered over a documentation layout. It should become a first-class layout rather than a set of global overrides.

### Interactive runtime

The theme registers lazy Vue components for:

- Archivist: browser LLM/book-search orchestration demo.
- Cartographer: streaming ETL/data orchestration demo with worker execution.
- Dispatcher: deterministic human-in-the-loop support demo.
- DagGraph: Cytoscape-based DAG visualization.
- DagJsonMermaid: JSON-LD-to-Mermaid paired visualization.

Supporting components cover graph controls, panes, traces, conversations, inspectors, persistence badges, legends, spinners, and runner controls. The runtime uses browser-only APIs such as window, document, localStorage, Worker, fullscreen, canvas measurement, and dynamically imported browser providers. These must not be treated as ordinary server-only Astro markup.

The example applications are moving toward their own Vite entrypoints under examples/the-archivist, examples/the-cartographer, and examples/the-dispatcher. That separation is directionally correct and should be completed.

### Build and deployment

The root scripts make VitePress the docs build contract:

~~~text
docs:dev       vitepress dev docs
docs:build     stamp version, then run scripts/docs-build.mjs
docs:preview   vitepress preview docs
typecheck:docs vue-tsc against docs/tsconfig.json
~~~

The build also integrates Twoslash, Mermaid, transformer model assets, Vite aliases into examples and src/viz, and generated public metadata. The output is a compiled application bundle, not just HTML. The new site must keep these as explicit build inputs and must not bundle every demo dependency into every page.

### Published artifact contract

The currently built site is not just "pages plus CSS." The checked build output under `docs/.vitepress/dist` contains 407 files, including:

- one route module per Markdown page, plus lean variants and shared framework chunks;
- a generated local-search index bundle for client-side search;
- RSS output (`feed.xml`) generated from `CHANGELOG.md`;
- sitemap, robots, manifest, favicon stack, OG images, Apple touch icon, and version badge assets;
- `llms.txt` for machine-readable site guidance;
- shipped browser embedder/model assets under `@transformers-embedder/`, including ONNX and tokenizer files;
- worker and demo chunks for the interactive applications.

This matters for the Astro experiment because "feature parity" includes machine-facing and runtime-facing artifacts, not just visual routes.

### Metadata and discovery contract

The VitePress config is carrying an unusually heavy SEO and discovery workload that the proposal must preserve:

- canonical URLs and page-specific Open Graph/Twitter tags via `transformPageData()`;
- `BreadcrumbList` JSON-LD on every page;
- `HowTo` JSON-LD on `/examples/*` pages;
- site-level `SoftwareSourceCode`, `WebSite`, and `Organization` JSON-LD;
- search-engine verification tags sourced from `package.json`;
- RSS autodiscovery, sitemap link tags, manifest tags, and icon declarations;
- explicit `hreflang`, `robots`, referrer policy, and mobile web app metadata;
- external font preconnect and stylesheet loading.

An Astro replacement should treat this as a first-class migration area with tests. It is easy to recreate the visual page and silently lose rich results, canonical behavior, or feed discovery.

## Current GitHub Pages parity matrix

The modernization experiment should be judged against the current GitHub Pages contract in these buckets.

| Surface | Current evidence | What parity means in the experiment |
|---|---|---|
| Route corpus | 102 published Markdown routes under `docs/`, including home, guides, examples, reference, and the experiment page | every published content route is either preserved, redirected intentionally, or replaced with an exact canonical mapping |
| Global nav | `themeConfig.nav`, custom `TopBar.vue`, sidebar groups, edit links, outline, prev/next footer | header, mobile nav, sidebar, in-page outline, related/footer nav, and edit-link ownership are explicit and behaviorally equivalent |
| Search | `themeConfig.search.provider = 'local'` and emitted local-search chunk | users can search docs locally with equivalent scope and no server dependency |
| SEO/meta | `transformPageData()` emits canonical tags, page OG/Twitter tags, breadcrumbs, HowTo JSON-LD, modified-time metadata | page head output remains page-specific and machine-verifiable |
| Site metadata | site-level WebSite, Organization, SoftwareSourceCode JSON-LD plus verification and mobile-app tags | site identity and discovery metadata are preserved under the new shell |
| Feeds and machine-readable files | `buildEnd()` generates `feed.xml`; `docs/public` ships `robots.txt`, `manifest.webmanifest`, `llms.txt`, OG assets, favicons | all machine-readable outputs still exist at deterministic URLs under `/Dagonizer/` |
| Docs authoring contract | frontmatter-driven hero/footer blocks, snippet embeds, `ClientOnly`, globally registered Vue components | authors can still express the same content patterns without hand-authoring framework glue |
| Interactive demos | three demo pages host browser-executed apps, plus graph/diagram components | demo pages remain explanatory static docs first, then hydrate only the required runtime |
| Demo runtime assets | emitted demo chunks, worker entry chunk, vendored transformer/ONNX assets | client-only assets load from stable production paths and are not forced onto non-demo docs pages |
| Diagram runtime | Mermaid config, MermaidExplorer, DagGraph, DagJsonMermaid, Cytoscape chunks | diagrams and graph viewers remain interactive where they are today, with reduced-motion-safe behavior |
| Visual system | top bar, custom palette CSS, typography, icon treatment, home hero overrides | the new shell looks intentional and technical without inheriting framework internals |
| GitHub Pages deployment | `base: '/Dagonizer/'`, sitemap hostname, icons/assets built under that base | the experiment works correctly from the project-pages subpath, not only localhost root |

### Route buckets to verify

The current published route families are:

- root pages: `index`, `getting-started`, `concepts`, `architecture`;
- guides: 27 pages under `docs/guide/`;
- examples: 51 pages under `docs/examples/`, including the three live demo pages;
- reference: 20 pages under `docs/reference/`;
- experiments: `docs/experiments/modern-home.md`.

Those route families should become an explicit acceptance checklist during migration. "The docs mostly render" is too weak; each bucket has different shell, SEO, and runtime expectations.

### Shell and behavior checklist

The current site shell is not just a visual wrapper. It has concrete behaviors that should be preserved or consciously redesigned:

- top bar owns sidebar-toggle state and route-sensitive default open/closed behavior;
- home route suppresses the default home layout in favor of the doc-layout hero path;
- content pages keep sidebar, outline, previous/next navigation, and related links;
- local search, social links, edit links, and footer are configured centrally;
- Mermaid explorer installs client-side and upgrades diagrams after render;
- demo pages render explanatory Markdown around live client applications instead of becoming application-only routes.

If the Astro experiment changes any of these, the proposal should call that out as an intentional product decision rather than accidental drift.

### Ownership and verification table

The experiment should assign every current GitHub Pages responsibility to a future owner and a concrete verification method.

| Current responsibility | Current source/evidence | Proposed owner in the experiment | Verification method |
|---|---|---|---|
| Home route and hero composition | `docs/index.md`, `HomeHero.vue`, `TopBar.vue` | Astro marketing page plus shared shell components | visual comparison, route smoke test, head-tag diff |
| Guide/reference/example Markdown rendering | `docs/guide/*`, `docs/reference/*`, `docs/examples/*` | Starlight content collections and docs layouts | route inventory diff, content spot-check, snippet render check |
| Experiment route isolation | `docs/experiments/modern-home.md`, `ExperimentalHomeHero.vue` | separate Astro experimental route tree | explicit route map and no-impact proof on production docs routes |
| Sidebar, top bar, footer, outline, edit links | `themeConfig`, `TopBar.vue`, `DocFooter.vue` | shared docs shell layer in Astro/Starlight | keyboard/navigation smoke test and mobile behavior check |
| Local search | emitted `@localSearchIndex...` chunk, `themeConfig.search.provider = 'local'` | Starlight/Astro local-search integration | built artifact presence plus query smoke test |
| Page-specific SEO/head output | `transformPageData()` in `docs/.vitepress/config.ts` | Astro page/head helpers | head-tag assertions against representative routes |
| Site-level structured data | JSON-LD blocks in `docs/.vitepress/config.ts` | Astro layout metadata module | rendered HTML assertions for homepage and one docs route |
| RSS feed | `buildEnd()` writes `feed.xml` | dedicated site build step or Astro integration hook | artifact existence and XML validity check |
| Sitemap | VitePress sitemap config plus `robots.txt` reference | Astro sitemap integration | artifact existence and URL-base assertions |
| `robots.txt` | `docs/public/robots.txt` | static public asset owner in site package | exact-content assertion and path check |
| Web app manifest | `docs/public/manifest.webmanifest` | static public asset owner in site package | manifest schema check and icon URL validation |
| `llms.txt` | `docs/public/llms.txt` | generated or static machine-readable docs artifact | exact-content diff or stable regeneration test |
| Icon and OG asset stack | `docs/public/*favicon*`, `og-image.*`, `apple-touch-icon.png`, `version-badge.svg` | shared public asset pipeline | file existence, path, and social-preview verification |
| Mermaid rendering and explorer upgrade | Mermaid config, `MermaidExplorer.install()`, `explorer.css` | docs visualization layer with client enhancement | representative diagram render test and client-side explorer smoke test |
| Live DAG graph components | `DagGraph.vue`, `DagJsonMermaid.vue` | Vue islands in docs or dedicated demo runtime | hydration smoke test and bundle-boundary inspection |
| Demo applications | `docs/examples/the-archivist.md`, `the-cartographer.md`, `the-dispatcher.md` plus example app packages | standalone Vite demo apps mounted from Astro docs/demos pages | route smoke test, interaction smoke test, worker-path check |
| Browser embedder/model assets | emitted `@transformers-embedder/**` files | demo/runtime asset pipeline, not docs shell | production-path fetch test and non-demo bundle budget check |
| Build failure gate for SSR render errors | `scripts/docs-build.mjs` | equivalent site build wrapper or CI assertion | forced-failure test proving doc-render exceptions fail the build |

This table is the practical bridge from audit to implementation. If a future Astro package does not have a named owner for one of these rows, parity is unproven.

### Acceptance appendix: exact current route families

The current published Markdown routes break down as follows:

| Family | Count | Current paths | Acceptance expectation |
|---|---|---|---|
| Root | 4 | `index.md`, `getting-started.md`, `concepts.md`, `architecture.md` | direct parity or explicit canonical redirect |
| Guides | 27 | `guide/authoring.md`, `guide/builder.md`, `guide/cancellation.md`, `guide/chat-event-orchestration.md`, `guide/checkpoint.md`, `guide/conversational.md`, `guide/distribution.md`, `guide/execution-tuning.md`, `guide/hitl.md`, `guide/iri-identity.md`, `guide/json-ld.md`, `guide/lifecycle-phases.md`, `guide/migrating-to-batch.md`, `guide/observability.md`, `guide/persistence.md`, `guide/plugins.md`, `guide/plural-native.md`, `guide/react-agent.md`, `guide/reservoir.md`, `guide/retry.md`, `guide/schema.md`, `guide/services.md`, `guide/shared-state.md`, `guide/state-accessor.md`, `guide/streaming-producers.md`, `guide/subclassing.md`, `guide/visualization.md` | preserve slugs, snippets, outline behavior, related-link rendering |
| Examples | 50 | `examples/01-linear.md` through `examples/36-dag-stream-producer.md`, plus `examples/constants-usage.md`, `examples/iri-identity.md`, `examples/monadic-node.md`, `examples/react-agent-memory.md`, `examples/react-agent-routing.md`, `examples/scatter-extensions.md`, `examples/state-accessor.md`, `examples/store-remote.md`, `examples/the-archivist.md`, `examples/the-cartographer.md`, `examples/the-dispatcher.md`, `examples/virtual-clock.md` | preserve numbered-example slugs, live demo embeds, and HowTo JSON-LD eligibility |
| Reference | 20 | `reference/adapters.md`, `reference/channels.md`, `reference/checkpoint.md`, `reference/container.md`, `reference/contracts.md`, `reference/core.md`, `reference/dagonizer.md`, `reference/entities.md`, `reference/errors.md`, `reference/execution.md`, `reference/import-map.md`, `reference/lifecycle.md`, `reference/nodes.md`, `reference/rdf-12.md`, `reference/runner.md`, `reference/runtime.md`, `reference/store.md`, `reference/testing.md`, `reference/validation.md`, `reference/viz.md` | preserve slug stability, reference density, and edit-link behavior |
| Experiments | 1 | `experiments/modern-home.md` | remain isolated from production docs and nav unless intentionally promoted |

The total published Markdown route count is therefore `4 + 27 + 50 + 20 + 1 = 102`.

### Acceptance appendix: exact current public files

The current `docs/public/` contract, excluding `.DS_Store`, is:

| File | Role | Acceptance expectation |
|---|---|---|
| `apple-touch-icon.png` | iOS/web-app icon | preserved at stable path |
| `dagonizer-icon-512.png` | large installable/PWA icon | preserved at stable path |
| `dagonizer-icon-transparent.png` | transparent brand asset | preserved if still referenced; otherwise consciously retired |
| `dagonizer-icon.svg` | canonical SVG brand icon | preserved at stable path |
| `dagonizer-node.svg` | node/brand diagram asset | preserved if still referenced |
| `dagonizer-node.svg.template` | source template for generated asset | preserve generation source or document replacement |
| `favicon-16.png` | favicon asset | preserved at stable path |
| `favicon-192.png` | installable/icon asset | preserved at stable path |
| `favicon-32.png` | favicon asset | preserved at stable path |
| `favicon.ico` | legacy favicon path | preserved at stable path |
| `llms.txt` | machine-readable site guide | preserved with stable content or generated equivalent |
| `manifest.webmanifest` | installable-site manifest | preserved with correct base-path URLs |
| `nodejs-node.svg` | documentation/supporting asset | preserved if still referenced |
| `og-image.png` | social preview image | preserved at stable path |
| `og-image.svg` | source or alternate OG asset | preserved if still referenced |
| `og-image.svg.template` | source template for generated OG asset | preserve generation source or document replacement |
| `robots.txt` | crawler policy and sitemap pointer | preserved at stable path |
| `version-badge.svg` | generated version badge | preserved or regenerated from the new build |
| `version-badge.svg.template` | source template for generated badge | preserve generation source or document replacement |

These files should be treated as acceptance inputs, not incidental leftovers. If the experiment drops one, the proposal should state whether it is replaced, redirected, regenerated, or intentionally removed.

### Acceptance appendix: execution matrix

The matrix below converts the current route and artifact inventory into implementation-facing acceptance checks.

| Current item(s) | Future owner | Target output path | Verification command/assertion |
|---|---|---|---|
| `index.md` | `site/src/pages/index.astro` plus marketing shell | `/Dagonizer/` | confirm route renders under base path; assert canonical URL is `https://studnicky.github.io/Dagonizer/`; compare hero/nav/footer visually |
| `getting-started.md`, `concepts.md`, `architecture.md` | `site/src/content/docs/*` via Starlight docs layout | `/Dagonizer/getting-started`, `/Dagonizer/concepts`, `/Dagonizer/architecture` | assert output routes exist; assert page title, description, outline, edit link, and related-footer blocks render |
| All 27 `guide/*.md` pages | `site/src/content/docs/guide/*` | `/Dagonizer/guide/*` | route inventory diff: every current guide slug exists or redirects canonically; snippet include smoke check on representative guide pages |
| All 20 `reference/*.md` pages | `site/src/content/docs/reference/*` | `/Dagonizer/reference/*` | route inventory diff; assert dense docs layout, edit links, outline, and page-specific canonical/head tags on representative pages |
| Example pages `examples/01-linear.md` through `examples/36-dag-stream-producer.md` | `site/src/content/docs/examples/*` | `/Dagonizer/examples/*` | route inventory diff; assert numbered slugs are preserved and example pages still emit HowTo-eligible metadata |
| Supporting example pages `constants-usage`, `iri-identity`, `monadic-node`, `react-agent-memory`, `react-agent-routing`, `scatter-extensions`, `state-accessor`, `store-remote`, `virtual-clock` | `site/src/content/docs/examples/*` | `/Dagonizer/examples/*` | assert supporting-example slugs remain reachable and retain snippet-backed content |
| Live demo doc pages `the-archivist`, `the-cartographer`, `the-dispatcher` | Starlight content page plus mounted demo runtime | `/Dagonizer/examples/the-archivist`, `/Dagonizer/examples/the-cartographer`, `/Dagonizer/examples/the-dispatcher` | assert static doc shell renders before hydration; smoke-test client mount, worker paths, and no hydration mismatch |
| `experiments/modern-home.md` | separate Astro experimental route | `/Dagonizer/experiments/modern-home` or intentional replacement path | assert route isolation from production docs nav and no regression on `/Dagonizer/` |
| `TopBar.vue`, `HomeHero.vue`, `DocFooter.vue` behaviors | shared Astro/Starlight shell components | shared shell, not content paths | keyboard/mobile smoke test: sidebar toggle, route-sensitive open state, related links, prev/next, edit link |
| Local search chunk and search config | Starlight/Astro local-search integration | emitted search index asset(s) under `/Dagonizer/assets/` | search smoke test for at least one guide, one reference page, and one example page; assert no server dependency |
| `transformPageData()` page metadata behavior | Astro metadata helper module | page head of every docs route | HTML assertion on representative routes for canonical, OG/Twitter, breadcrumb JSON-LD, modified-time metadata |
| Site-level JSON-LD blocks | Astro root layout metadata module | homepage and docs layout HTML | assert `WebSite`, `Organization`, and `SoftwareSourceCode` JSON-LD appear with correct URLs |
| RSS feed generated from `CHANGELOG.md` | site build hook/integration | `/Dagonizer/feed.xml` | build and assert file exists, parses as XML, and contains changelog item links under `/Dagonizer/` |
| Sitemap | Astro sitemap integration | `/Dagonizer/sitemap.xml` | build and assert file exists with base-path URLs only |
| `robots.txt` | static asset pipeline | `/Dagonizer/robots.txt` | exact-content assertion, including sitemap URL |
| `manifest.webmanifest` | static asset pipeline | `/Dagonizer/manifest.webmanifest` | schema parse and assert `id`, `start_url`, `scope`, and icon URLs retain `/Dagonizer/` base |
| `llms.txt` | generated or static machine-readable artifact | `/Dagonizer/llms.txt` | exact-content diff or stable regeneration snapshot test |
| `apple-touch-icon.png`, `favicon-16.png`, `favicon-32.png`, `favicon-192.png`, `favicon.ico`, `dagonizer-icon.svg`, `dagonizer-icon-512.png` | shared public asset pipeline | same filenames under `/Dagonizer/` | build and assert all files exist and referenced head tags resolve |
| `og-image.png`, `og-image.svg`, `og-image.svg.template` | social-preview asset pipeline | same filenames under `/Dagonizer/` | assert homepage and docs pages reference valid OG image URL; preserve template or document replacement |
| `version-badge.svg`, `version-badge.svg.template` | generated asset pipeline | same filenames under `/Dagonizer/` | build and assert badge exists; if generation changes, document exact replacement step |
| `dagonizer-node.svg`, `dagonizer-node.svg.template`, `nodejs-node.svg`, `dagonizer-icon-transparent.png` | shared docs asset pipeline | same filenames if still referenced | reference search plus built-asset existence check; if removed, record replacement or intentional retirement |
| Mermaid explorer and rendered diagrams | docs visualization enhancement layer | client-side enhancement on docs pages | smoke test representative Mermaid pages and verify explorer affordances attach after render |
| `DagGraph.vue` and `DagJsonMermaid.vue` islands | Vue islands or demo-runtime mounts | docs pages that currently embed these components | assert hydration works only where needed and does not inflate non-demo docs bundles |
| Demo runtime assets and worker chunk(s) | demo asset pipeline | emitted JS/WASM/model assets under `/Dagonizer/assets/` and `/Dagonizer/@transformers-embedder/` | fetch-test emitted runtime paths in production preview; assert non-demo routes do not preload them unnecessarily |
| `@transformers-embedder/**` vendored model/runtime files | demo/runtime asset pipeline | `/Dagonizer/@transformers-embedder/**` | assert model, tokenizer, and ORT files are present and client fetches succeed in demo routes |
| SSR render-failure gate from `scripts/docs-build.mjs` | site build wrapper or CI assertion | build contract, not public path | forced-failure test proving a doc render exception fails the build instead of shipping silently |

The intent is not to keep VitePress-specific file ownership forever. The intent is to make every currently shipped responsibility survive the migration with a named owner and a proof step.

### Acceptance appendix: CI-oriented verification blueprint

The current repository already has a docs build contract:

~~~text
pnpm run typecheck:docs
pnpm run docs:build
~~~

The modernization experiment should keep an equivalent contract and add explicit post-build assertions. A practical verification sequence looks like:

~~~text
1. pnpm run typecheck:docs
2. pnpm run docs:build
3. assert route inventory
4. assert machine-readable/public files
5. assert page metadata on representative routes
6. assert demo/runtime asset presence
7. run browser smoke checks for shell/search/demos
~~~

Suggested assertion shapes:

| Check class | Current evidence | Concrete assertion pattern |
|---|---|---|
| Route inventory | `docs/**/*.md` excluding `.vitepress` and `.orchestration` | generate expected route list from current docs tree and diff it against emitted experiment routes |
| Base-path correctness | current site uses `/Dagonizer/` | reject any emitted canonical, manifest, sitemap, robots, or asset URL that drops the `/Dagonizer/` prefix |
| Public file presence | current `docs/public/*` contract | assert every required public file exists in the built output except items intentionally retired in the migration plan |
| Head metadata | `transformPageData()` behavior | parse representative HTML pages and assert canonical, OG/Twitter tags, breadcrumb JSON-LD, and page description content |
| Search | emitted local-search asset and configured local provider | assert a local-search asset exists and browser smoke-test at least one query from each major route family |
| Demo isolation | heavy runtime currently lazy-loaded | assert non-demo docs routes do not preload demo/model bundles; assert demo routes can fetch their required chunks |
| Worker/runtime fetches | current demo pages emit worker and `@transformers-embedder/` assets | fetch-test worker chunk(s), WASM, tokenizer, ONNX, and model config from a production preview |
| Build-failure gate | `scripts/docs-build.mjs` | inject or simulate a doc render failure and assert the build exits non-zero |

Representative command snippets the future site package should support:

```text
pnpm run typecheck:docs
pnpm run docs:build
find <site-dist> -type f
rg '/Dagonizer/' <site-dist>/**/*.html
rg 'canonical|og:|twitter:|BreadcrumbList|HowTo' <site-dist>/**/*.html
```

Representative assertions:

- homepage HTML contains the expected canonical URL and site-level JSON-LD;
- `getting-started`, one guide page, one reference page, and one numbered example page contain page-specific metadata and edit-link affordances;
- `feed.xml`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, and `llms.txt` all exist in the final output;
- demo routes can load their runtime assets without forcing those assets onto unrelated docs routes;
- at least one Mermaid page and one DAG-graph page pass client-side smoke checks.

This blueprint is intentionally verification-first. It is the standard the Astro experiment should meet before any production switch is considered.

### Current-state evidence status

The audit now has stronger current-state proof from the repository itself, not only static inspection.

Published-site note: the canonical GitHub Pages origin configured by the repository is `https://studnicky.github.io/Dagonizer/`. A probe against `https://studs.github.io/Dagonizer/` returns the default GitHub Pages 404 and is not the deployed site for this repository. The audit treats `studnicky.github.io` as authoritative because that base URL is declared in [docs/.vitepress/config.ts](docs/.vitepress/config.ts) and emitted by the production site itself.

| Requirement area | Current evidence | Status |
|---|---|---|
| Docs TypeScript contract | `pnpm run typecheck:docs` exits 0 against `docs/tsconfig.json` | proven |
| Docs production build | `pnpm run docs:build` exits 0 via `scripts/docs-build.mjs` | proven |
| GitHub Pages deployment wiring | `.github/workflows/pages.yml` builds on pushes to `main`, uploads `docs/.vitepress/dist`, and deploys with `actions/deploy-pages` | proven |
| Live published origin | `https://studnicky.github.io/Dagonizer/` returns HTTP 200 on July 16, 2026; HTML identifies itself as `VitePress v1.6.4` with `/Dagonizer/` asset paths | proven |
| Sitemap generation | current build logs `generating sitemap...` and completes successfully | proven |
| Generated versioned assets | `stamp-version` rewrites `dagonizer-node.svg`, `og-image.svg`, and `version-badge.svg` during docs build | proven |
| Published route inventory | live file-system count after excluding `.vitepress` and nested `.orchestration` artifacts | proven |
| Published nav/sidebar contract | live home-page HTML contains serialized `__VP_SITE_DATA__` with top-nav entries, sidebar groups, footer, search provider, edit-link pattern, and clean-URL setting | proven |
| Public asset inventory | live `docs/public/` file list excluding `.DS_Store` | proven |
| Clean-URL route emission | built output includes `index.html`, `getting-started.html`, `guide/authoring.html`, `reference/dagonizer.html`, `examples/the-archivist.html`, and corresponding route assets | proven |
| Local search asset emission | built dist contains a local-search chunk | proven |
| Demo/model asset emission | built dist contains demo chunks, worker chunk(s), and `@transformers-embedder/**` files | proven |
| Bundle-size pressure | current build emits large-chunk warnings after minification | proven risk |
| Page-level metadata semantics | built representative HTML pages contain canonical, OG/Twitter, breadcrumb JSON-LD, article metadata, and example-page HowTo JSON-LD | proven |
| Emitted shell output | built representative HTML pages contain top bar markup, search button markup, nav links, sidebar structure, edit links, outline container, and footer output | proven |
| Feed and sitemap contents | emitted `feed.xml` and `sitemap.xml` contain `https://studnicky.github.io/Dagonizer/` URLs; local sitemap coverage check reports 102 routes, 102 sitemap entries, 0 missing, 0 extra; live sitemap and feed are publicly reachable | proven |
| Core machine-readable outputs | built dist contains `feed.xml`, `sitemap.xml`, `llms.txt`, `manifest.webmanifest`, and `robots.txt`; live `manifest.webmanifest` and `llms.txt` return HTTP 200 from GitHub Pages | proven |
| External origin dependencies | live HTML preconnects to `fonts.googleapis.com`, `fonts.gstatic.com`, and `esm.run`; the config documents Google Fonts as immediate dependencies and `esm.run` as the lazy WebLLM bundle origin | proven |
| Published asset-class contract | built dist ships hashed route-entry chunks, shared framework/theme chunks, local-search chunks, Mermaid/Cytoscape/diagram chunks, demo runner chunks, worker entry assets, local font subsets, and `@transformers-embedder/ort/**` runtime assets | proven |
| Static 404 behavior | built dist contains `404.html`; live `https://studnicky.github.io/Dagonizer/404.html` returns HTTP 200 and an arbitrary missing route returns HTTP 404 with the same custom Dagonizer 404 document | proven |
| Service-worker absence | no `sw.js` or service-worker file exists in built dist; live `/Dagonizer/sw.js` returns HTTP 404 | proven |
| Custom-domain absence | built dist contains no `CNAME`; the canonical site is the GitHub Pages project-site URL under `studnicky.github.io/Dagonizer/` | proven |
| Delivery/cache policy | live HTML, hashed JS/CSS, local fonts, and `hashmap.json` all return `cache-control: max-age=600` from GitHub Pages | proven |
| Client-router 404 shell | built and live `404.html` include `app.*.js`, `__VP_HASH_MAP__`, and `__VP_SITE_DATA__`, with the body starting as `<div id=\"app\"></div>` for client hydration | proven |
| Mobile/keyboard shell behavior | inferred from component code and rendered markup; browser interaction could not be automated in this session | indirect |
| Search interaction quality | search UI markup and local-search asset are emitted; actual query interaction was not browser-verified in this session | indirect |
| Demo runtime behavior in-browser | inferred from code and emitted assets; not browser-smoked in this audit pass | indirect |

This distinction matters. The audit now proves that the current repository builds and emits the expected docs-site contract. It does not yet prove every interactive behavior in a live browser session. The modernization experiment should treat the `indirect` rows as mandatory runtime verification targets.

### Pending runtime verification

The remaining unproven surface is not conceptual. It is a finite browser-verification checklist against the current GitHub Pages contract.

| Area | Route(s) | Interaction to verify | Required evidence for `proven` | Failure examples to capture |
|---|---|---|---|---|
| Desktop shell navigation | `/Dagonizer/`, `/Dagonizer/guide/authoring`, `/Dagonizer/reference/dagonizer` | top bar links, docs nav links, edit-link visibility, outline presence, footer links | screen/DOM evidence that links render, navigate correctly under the base path, and preserve the expected shell regions | broken base-path links, missing top bar, missing outline, missing footer, wrong active state |
| Mobile shell navigation | `/Dagonizer/`, `/Dagonizer/guide/authoring` | open mobile nav, open/close sidebar drawer, verify body scroll lock and dismissal behavior | browser evidence that nav and sidebar can be opened and dismissed on narrow viewport without trapping the page in a broken scroll state | drawer cannot open, cannot close, body scroll leaks, overlay blocks content permanently |
| Keyboard accessibility | `/Dagonizer/guide/authoring`, `/Dagonizer/examples/the-archivist` | tab order through top bar/search/sidebar controls, enter/space activation, escape dismissal where applicable, visible focus state | browser evidence that shell controls are reachable and operable without pointer input and that focus remains visible | unreachable controls, invisible focus, escape does not dismiss overlays, focus lost after close |
| Local search behavior | `/Dagonizer/guide/authoring` | open search UI, query at least one guide term, one reference term, and one example term, then navigate via a result | browser evidence that search opens, returns relevant results from multiple route families, and navigates to the selected page | no results, partial index, broken result links, overlay stuck open |
| Demo runtime boot | `/Dagonizer/examples/the-archivist` | load the page, allow client runtime to hydrate, verify visible demo UI and absence of fatal initialization failure | browser evidence that the page mounts interactive demo UI and does not fail on initial client boot | hydration mismatch, uncaught runtime error, blank mount, worker/model asset 404 |
| Demo runtime network/assets | `/Dagonizer/examples/the-archivist` | inspect runtime requests for chunks, worker assets, and model assets needed by the page | network/log evidence that required assets load from the correct `/Dagonizer/` paths without 404 or MIME failures | worker URL wrong, chunk 404, model asset 404, CSP or MIME failure |
| Reduced-motion safety | `/Dagonizer/`, `/Dagonizer/guide/authoring` | enable reduced motion and repeat shell interactions | browser evidence that critical interactions remain usable and any motion-heavy behavior degrades cleanly | motion-only affordance, unreadable transition state, blocked interaction when animations are reduced |

For this audit, `proven` means one of:

- browser automation output tied to an exact route and interaction sequence;
- console/network evidence captured during that same pass;
- screenshots only when the visual layout itself is the requirement.

Static markup inspection is not enough for any row in this table.

### Publication/runtime surface that the redesign must account for

The current GitHub Pages site publishes more than a static docs shell. It has a concrete browser runtime surface that any replacement needs to preserve, reduce deliberately, or replace with an explicit new owner.

| Surface | Current evidence | Why it matters to modernization |
|---|---|---|
| Hashed route-entry assets | built dist contains per-page `*.md.*.js` and `*.lean.js` entry files for docs routes and examples | route-level code splitting is part of the current publish model; the redesign should not accidentally collapse all routes into one large client bundle |
| Shared framework/theme chunks | built dist contains shared framework, theme, layout, transform, and support chunks | the shell is partially centralized today; replacement architecture should make shared shell/runtime ownership explicit |
| Local-search payload | built dist contains dedicated local-search index and UI chunks; live shell exposes local search UI | search is a shipped browser feature, not just a markup affordance |
| Diagram/rendering payload | built dist contains Mermaid, KaTeX, Cytoscape, Dagre, Cose-Bilkent, and many diagram-definition chunks | the docs surface currently supports rich technical diagrams and graph rendering without server support |
| Demo/application payload | built dist contains `ArchivistRunner`, `CartographerRunner`, `DispatcherRunner`, `TraceFeed`, tab/pane UI, and related demo chunks | examples are partly mini-applications; the redesign cannot reduce them to static screenshots or prose pages |
| Browser ML/runtime payload | built dist contains `@transformers-embedder/ort/**`, transformer-web chunks, and worker-oriented assets | part of the in-browser AI/runtime story is shipped to static hosting today |
| Font delivery model | live HTML preconnects to Google Fonts and preloads local Inter subsets from `/Dagonizer/assets/*.woff2` | typography is split across third-party CSS and local binaries; the redesign should choose whether to keep or remove that dependency mix |
| Third-party network origins | config and live HTML reference `fonts.googleapis.com`, `fonts.gstatic.com`, and `esm.run` | the current site is not fully origin-isolated to GitHub Pages; this affects privacy, performance, offline expectations, and CSP design |

This is part of the current GitHub Pages contract even when the user never opens the demos. The modernization proposal has to state which of these surfaces remain, which are simplified, and which are intentionally removed.

### Hosting-level GitHub Pages contract

The current published site also has hosting behaviors that are easy to miss if the audit stops at page HTML.

| Hosting behavior | Current evidence | Preservation implication |
|---|---|---|
| Project-site base path | canonical URLs, assets, and routes live under `/Dagonizer/` | any experiment has to work correctly under a subpath, not only at `/` |
| Static-file deployment | `.github/workflows/pages.yml` uploads `docs/.vitepress/dist` directly to GitHub Pages | no server-side runtime, request middleware, or edge logic is part of the current production contract |
| Custom 404 document | built dist ships `404.html`; missing routes on GitHub Pages return that document with HTTP 404 | replacement must keep a branded error page and subpath-safe missing-route behavior |
| No service worker/PWA offline shell | no published `sw.js` exists | modernization can add offline behavior only as a deliberate expansion, not as an assumed current feature |
| No custom domain indirection | no `CNAME` file is published | route/base-path logic should continue to assume GitHub Pages project-site hosting unless intentionally changed |
| Hidden-file non-contract | no Pages-specific hidden publish file is relied on in the built output | the redesign should not assume hidden control files are available unless explicitly added and verified |
| Short TTL delivery | live HTML, JS, CSS, fonts, and `hashmap.json` all return `cache-control: max-age=600` | the current site does not rely on long-lived immutable CDN caching; a redesign can improve this, but must treat it as a behavior change |
| Hydrated 404 shell | `404.html` ships the same client router/site-data bootstrap as the main site and starts from an empty `#app` mount | missing-route behavior is partly a client-rendered shell, not only a static error document |

These are not cosmetic details. They constrain routing, asset URLs, client-side navigation fallbacks, and what kinds of framework features are safe to introduce.

### Published-site evidence captured directly

The current audit no longer relies only on local build output. The following published-state facts are directly verified against GitHub Pages as of July 16, 2026:

- `https://studnicky.github.io/Dagonizer/` returns HTTP 200.
- The live home page emits canonical `/Dagonizer/` asset paths and identifies the runtime as VitePress.
- The live home page contains the expected shell regions: top bar, search button, main nav, mobile hamburger, local nav button, sidebar, edit link, doc footer, and site footer.
- The live home page serializes `__VP_SITE_DATA__`, exposing the actual nav, sidebar groups, social links, footer text, edit-link pattern, outline label, and `cleanUrls: true`.
- `https://studnicky.github.io/Dagonizer/sitemap.xml` is live and serves the expected route family.
- `https://studnicky.github.io/Dagonizer/feed.xml` is live and serves the changelog feed.
- `https://studnicky.github.io/Dagonizer/manifest.webmanifest` and `https://studnicky.github.io/Dagonizer/llms.txt` both return HTTP 200.
- The live home page and example pages preconnect to `fonts.googleapis.com`, `fonts.gstatic.com`, and `esm.run`.
- The live example page for `https://studnicky.github.io/Dagonizer/examples/the-archivist` emits page-specific canonical/OG/Twitter metadata and a `HowTo` JSON-LD block.
- `https://studnicky.github.io/Dagonizer/404.html` is live, and an arbitrary missing route returns HTTP 404 with the same custom Dagonizer 404 payload instead of the default GitHub Pages error page.
- `https://studnicky.github.io/Dagonizer/sw.js` returns HTTP 404, matching the absence of a published service worker in the build output.
- `https://studnicky.github.io/Dagonizer/`, `assets/app.BHMHvwLx.js`, `assets/style.BFHZ-MKb.css`, `assets/inter-roman-latin.Di8DUHzh.woff2`, and `hashmap.json` all return `cache-control: max-age=600`.
- The live `404.html` and missing-route responses bootstrap the VitePress app shell with `__VP_HASH_MAP__` and `__VP_SITE_DATA__`, rather than serving a dead standalone HTML error card.

These checks matter because the modernization proposal must preserve what the current GitHub Pages site actually publishes, not only what the repo can build locally.

### Runtime verification exit criteria

The next browser-enabled pass should close the remaining audit rows only if all of the following are true:

1. The shell works on both desktop and narrow mobile viewport under the `/Dagonizer/` base path.
2. Search returns and navigates to results from guide, reference, and examples route families.
3. At least one real demo route boots without fatal client errors and without broken asset paths.
4. Keyboard-only interaction can traverse and operate the shell controls that the current site exposes.
5. Any failure is recorded here as a concrete gap with exact route, trigger, and observable symptom rather than left as `indirect`.

## Strengths to preserve

- Static HTML and crawlable Markdown.
- Source-backed examples and Twoslash validation.
- Mermaid diagrams and JSON-LD as canonical demonstration artifacts.
- Lazy loading for expensive demo components.
- The existing three demos and their real execution paths.
- /Dagonizer/ base-path compatibility for GitHub Pages.
- Sitemap, feed, favicon stack, manifest, OG image, version badge, `llms.txt`, and metadata.
- Page-level canonical/OG/Twitter/JSON-LD generation.
- Local search and the search-result behavior users already have.
- Snippet includes and frontmatter-driven related-navigation blocks.
- The technical palette: near-black surfaces, cyan primary accent, violet secondary accent, restrained gold emphasis.
- Existing documentation taxonomy and canonical links.

## Problems the new architecture should solve

### Shell coupling

The nav bar, sidebar, home hero, and footer are connected through VitePress theme slots and global selectors. Marketing pages need different composition rules from reference pages, but both inherit the same layout contract.

### Global CSS responsibility

The custom CSS restyles VitePress variables, nav and sidebar internals, content surfaces, Mermaid output, code blocks, buttons, typography, and brand backgrounds. A visual change becomes cross-cutting and it is hard to distinguish product primitives from framework overrides.

### Hidden component ownership

Global registration makes major demos and visualization blocks convenient for Markdown authors, but obscures bundle boundaries and makes the site shell aware of demo implementation details.

### Build-time contract sprawl

The docs build currently owns generated feeds, structured data, search indexing, font loading, icon stacks, machine-readable text files, and shipped browser-model assets. Those responsibilities are valid, but they are spread across VitePress config, public assets, examples tooling, and theme registration. The migration should separate "docs shell," "demo runtime," and "public artifact generation" into explicit owners.

### Marketing interactions

Scroll reveals, pinned sections, animated galleries, product comparisons, and responsive art direction are possible in VitePress, but become custom Vue theme work. A marketing route should own its layout and interaction boundary.

## Proposed target architecture

~~~mermaid
flowchart TB
  content[Markdown and content collections]
  astro[Astro site]
  marketing[Marketing routes]
  starlight[Starlight documentation routes]
  islands[Explicit Vue islands]
  apps[Standalone demo applications]
  ui[Shared tokens and UI primitives]
  prime[PrimeVue controls and data components]
  core[Dagonizer packages and viz package]

  content --> astro
  astro --> marketing
  astro --> starlight
  marketing --> ui
  starlight --> ui
  marketing --> islands
  starlight --> islands
  islands --> prime
  islands --> core
  apps --> core
  apps --> prime
~~~

Use Astro file-based pages for the product surface. Use Starlight for docs because it supplies documentation navigation, search, code presentation, SEO, dark mode, and component override points. Starlight also supports custom Astro pages and selective overrides.

Suggested ownership:

~~~text
site/
  src/pages/index.astro                 marketing home
  src/pages/product/[slug].astro       product pages
  src/pages/demos/[demo].astro         demo launch pages
  src/content/docs/                    documentation corpus
  src/components/marketing/            Astro-first sections and shell
  src/components/docs/                 documentation wrappers
  src/components/islands/              Vue components with explicit hydration
  src/styles/tokens.css                brand tokens and semantic surfaces
  src/styles/motion.css                reduced-motion-safe animation rules
  src/lib/                              metadata and navigation helpers
examples/                               standalone demo entrypoints
packages/                               product/runtime packages
~~~

### Rendering boundaries

| Boundary | Rendering | Examples |
|---|---|---|
| Marketing shell | Astro static HTML | header, top bar, hero, feature sections, footer |
| Content pages | Astro/Starlight static HTML | guides, reference, examples, changelog |
| Lightweight motion | CSS and small client script | reveal, hover, progress, reduced-motion |
| UI controls | Vue island with explicit hydration | tabs, dialogs, inspectors, filters |
| Heavy demos | dedicated Vue app or island loaded on interaction | Archivist, Cartographer, Dispatcher |
| Browser-only runtime | client-only Vue code | workers, LLM, Cytoscape, fullscreen, storage |

The default should be static HTML. Hydrate only the component that needs state. Astro's islands model is a good fit because Vue components can remain in the repository without making every route a client application.

## Page-strategy blueprint

The current site mixes three jobs into one shell:

- product/marketing explanation;
- documentation and technical reference;
- live demonstration applications.

The updated version should separate those jobs at the route and component level while keeping one visual language and one metadata system.

### Proposed top-level route groups

| Route group | Purpose | Rendering model | Primary audience |
|---|---|---|---|
| `/` | product landing and positioning | Astro static marketing page | first-time visitors, evaluators, search |
| `/product/*` | feature deep-dives and capability storytelling | Astro static pages with light islands | evaluators, technical leads |
| `/use-cases/*` | solution narratives: agents, ETL, orchestration, browser demos | Astro static pages with diagrams/comparisons | buyers, architects, implementers |
| `/demos/*` | curated launch pages for the three flagship demos | Astro page plus explicit Vue island/app mount | evaluators who want proof |
| `/getting-started`, `/guide/*`, `/reference/*`, `/examples/*` | documentation corpus | Starlight docs routes | implementers and repeat users |
| `/experiments/*` | isolated design or interaction spikes | isolated Astro route tree | internal iteration only |

This gives marketing pages freedom to sell the product while preserving the dense, indexable, static-first docs corpus.

### Role of the current page families in the new site

| Current family | Current role | Future role |
|---|---|---|
| `index`, `getting-started`, `concepts`, `architecture` | mixed landing plus technical orientation | split into a true landing page, a product architecture page, and unchanged docs onboarding pages |
| `guide/*` | task-oriented education | remains docs-first, with better cross-links into product/use-case pages where appropriate |
| `reference/*` | API/reference density | remains docs-first and intentionally austere |
| `examples/*` numbered pages | progressive educational examples | remains in docs, framed as learning path rather than marketing surface |
| `examples/the-archivist`, `the-cartographer`, `the-dispatcher` | live proof pages | become both docs pages and top-level demo launch destinations via `/demos/*` wrappers |
| `experiments/modern-home` | visual spike | remains isolated until promoted or discarded |

## Component system and usage plan

The new site should not be a pile of one-off sections. It needs a small set of reusable, brand-aware blocks with clear ownership.

### Marketing-shell components

| Component | Used on | Purpose |
|---|---|---|
| `SiteHeader` | all routes | global navigation, docs entry, GitHub CTA, mobile menu |
| `AnnouncementBar` | optional marketing/product routes | release/status/pinned-message strip without contaminating docs pages |
| `SiteFooter` | all routes | docs/product/demo/repo links, license, ownership cues |
| `SectionFrame` | all marketing sections | consistent width, padding, eyebrow/title/body/action structure |
| `Grid` primitives | all marketing/product routes | disciplined layout without ad hoc spacing |

### Hero and positioning components

| Component | Used on | Purpose |
|---|---|---|
| `ProductHero` | `/` | concise positioning: what Dagonizer is, who it is for, and why it is different |
| `ProofBar` | `/` and `/product/*` | compact proof strip: browser-runnable, typed DAGs, checkpoint/resume, zero mandatory runtime |
| `PrimaryActions` | `/` | drive to demo, getting started, GitHub, and architecture |
| `ArchitectureHeroGraphic` | `/`, `/product/architecture` | static-first branded diagram illustrating the dispatcher/DAG model |

### Feature-storytelling components

| Component | Used on | Purpose |
|---|---|---|
| `FeatureCardGrid` | `/`, `/product/*` | summary of major capabilities with tight visual rhythm |
| `CapabilityDetailBand` | `/product/*` | one capability explained in depth with supporting bullets and evidence |
| `ComparisonMatrix` | `/product/*`, `/use-cases/*` | compare Dagonizer against ad hoc orchestration, workflow glue, or queue-bound systems |
| `ExecutionTimeline` | `/product/checkpointing`, `/use-cases/*` | explain flow phases, retries, cancellation, resume, and HITL visually |
| `DataFlowDiagramBlock` | `/product/architecture`, `/use-cases/*` | static diagram with optional expandable technical annotation |
| `EvidenceCallout` | throughout | short “why believe this” proof: links to demo, guide, or reference page |

### Demo and proof components

| Component | Used on | Purpose |
|---|---|---|
| `DemoLaunchHero` | `/demos/the-archivist`, etc. | gives the demo a strong identity before the app mounts |
| `DemoCapabilityChecklist` | demo pages | states what the demo proves technically |
| `DemoRuntimePanel` | demo pages | houses the Vue app/island mount with loading and failure states |
| `DemoTraceGallery` | demo pages | screenshots/video/GIF fallback for search and non-JS readers if desired |
| `RelatedDocsRail` | demo pages | links into guides/reference/examples that explain the underlying mechanisms |

### Documentation-support components

| Component | Used on | Purpose |
|---|---|---|
| `DocsCallout` | docs pages | notes, warnings, version caveats, migration cues |
| `APIStatBlock` | reference pages | compact display of signatures, runtime guarantees, constraints |
| `ExampleProgressRail` | numbered examples | makes the examples read as a coherent learning path |
| `SourceProofPanel` | examples/guides | links from prose claims to source-backed examples or reference APIs |
| `DiagramExplorerIsland` | docs/demo pages | explicit client enhancement for graph/diagram inspection only where needed |

### Application/UI components

These are the pieces PrimeVue should own or heavily influence:

- buttons, button groups, split buttons;
- tabs and segmented controls;
- dialogs, drawers, overlays, tooltips;
- tables, trees, accordions, timelines;
- badges, tags, progress, notifications;
- command/search surfaces where docs search or demo filtering needs them.

These are the pieces Dagonizer should own visually:

- hero graphics;
- feature cards;
- proof strips;
- architecture diagrams;
- metric blocks;
- branded code/example frames;
- demo launch wrappers;
- docs/marketing layout shells.

PrimeVue should provide dependable behavior; Dagonizer should provide identity.

## Feature-branding and showcase strategy

The site should not present features as a flat bullet list. It should merchandise them in layers from broad value to hard proof.

### Core feature pillars

| Pillar | Claim | Proof destinations |
|---|---|---|
| Typed orchestration | Dagonizer composes work as typed DAGs instead of ad hoc control flow | architecture page, getting started, reference/dagonizer |
| One engine, multiple workloads | same runtime handles LLM-agent flows and ETL/data workflows | home page, cartographer demo, archivist demo |
| Deterministic control | retries, cancellation, checkpoints, lifecycle phases, and HITL are explicit | guide pages for retry/cancellation/checkpoint/hitl plus dispatcher demo |
| Browser-runnable proof | the engine and demos run on static hosting with no mandatory backend | demo pages, examples, architecture callouts |
| Extensible boundaries | adapters, contracts, containers, stores, and plugins keep integration seams explicit | reference pages, plugins guide, distribution guide |

### How to showcase features on the site

| Feature | Best presentation pattern | Avoid |
|---|---|---|
| Checkpoint/resume | execution timeline plus before/after state explanation and demo link | vague “resilient workflows” copy with no proof |
| Retry/cancellation | capability band with compact lifecycle diagram | throwing them into a generic feature card only |
| Embedded DAG composition | architecture diagram plus expandable technical notes | explaining it only in dense prose |
| Browser execution | proof bar plus live demo CTA plus hosting callout | overstating it as “serverless AI” marketing fluff |
| Graph/visualization | screenshot/diagram plus docs link and optional island | full interactive graph on the landing page by default |
| LLM + ETL duality | side-by-side comparison block | making one workload invisible in favor of the other |

### Brand voice and visual positioning

The site should feel:

- precise, not playful;
- technical, not consumer-startup glossy;
- confident, not hype-heavy;
- dense where useful, but never visually chaotic;
- modern through structure, typography, and motion restraint rather than decorative noise.

The product story should read in this order:

1. what Dagonizer is;
2. what kinds of work it orchestrates;
3. why its control model is stronger than script glue;
4. where to see proof;
5. where to implement it.

## Marketing/info information architecture

### Recommended landing-page sequence

1. `ProductHero`
2. `ProofBar`
3. `FeatureCardGrid`
4. `ArchitectureHeroGraphic` with short explanation
5. `WorkloadSplit` comparing agent orchestration and ETL/data orchestration
6. `FlagshipDemosSection`
7. `CapabilityDetailBand` sections for checkpoint/resume, retries/cancellation, embedded DAGs, browser execution
8. `ComparisonMatrix`
9. `ImplementationPaths` linking to getting started, guides, reference
10. `SiteFooter`

This keeps the page indexable and content-rich while still reading like a polished product surface.

### Recommended flagship marketing pages

| Route | Purpose | Main components |
|---|---|---|
| `/product/architecture` | explain the DAG model and execution substrate | `ArchitectureHeroGraphic`, `DataFlowDiagramBlock`, `ExecutionTimeline`, `EvidenceCallout` |
| `/product/reliability` | checkpointing, retry, cancellation, lifecycle control | `CapabilityDetailBand`, `ExecutionTimeline`, `ComparisonMatrix` |
| `/product/browser-demos` | explain browser-runnable static-hosted proof surface | `ProofBar`, `DemoCapabilityChecklist`, `RelatedDocsRail` |
| `/use-cases/agents` | LLM-agent orchestration story | `FeatureCardGrid`, `EvidenceCallout`, demo CTAs |
| `/use-cases/data-pipelines` | ETL/data workflow story | `FeatureCardGrid`, `DataFlowDiagramBlock`, docs links |

### Recommended demo-launch structure

Each flagship demo route should have:

- a static hero describing what the demo proves;
- a capability checklist;
- a “how it works” summary linked to guides/reference;
- the live runtime panel;
- a fallback explanation if client runtime fails;
- related examples/reference links after the demo.

This makes the pages indexable and useful even before hydration.

## Performance and indexability rules

The new site should adopt explicit rules instead of “best effort”.

### Indexability rules

- all primary marketing and docs content must exist in static HTML;
- feature claims should be visible as crawlable text, not hidden behind tabs only;
- demo pages should ship explanatory prose before the app mount;
- canonical URLs, OG/Twitter tags, breadcrumbs, and existing structured-data behavior remain page-specific;
- high-value marketing pages should link directly to relevant docs/reference proof pages.

### Performance rules

- marketing routes should avoid hydrating large graph/demo runtimes by default;
- heavy demo/app bundles load only on demo routes or explicit user interaction;
- diagrams on marketing pages default to static or lightly enhanced render paths;
- third-party origins should be reduced where practical, especially if fonts can be self-hosted cleanly;
- shared shell and marketing pages should remain mostly static HTML plus CSS.

### Content rules

- one page, one job;
- feature pages explain product value first, implementation details second;
- docs pages explain implementation first, with restrained product framing;
- reference pages remain utilitarian and dense;
- every major marketing claim should have at least one linked proof destination in docs or demos.

## Dagonizer DAG visualizer review

This section is not about a generic Mermaid wrapper. The target is a better visualization surface for people who build on Dagonizer and need to inspect, present, and embed their own DAGs.

### How the current visualizer works

The current visualization stack is split into three layers:

| Layer | Current implementation | What it does |
|---|---|---|
| Static DAG-to-diagram rendering | `MermaidRenderer.render(dag, options?)` | emits Mermaid `flowchart` source from a `DAGType` |
| Structured interactive graph rendering | `CytoscapeRenderer.render(dag, options?)` and `CytoscapeGraph` | emits Cytoscape elements, computes layout, mounts an interactive graph |
| Docs/demo enhancement layer | `MermaidExplorer`, `AnimatedDagGraph`, `DagJsonMermaid`, docs-side wrappers | adds zoom/pan controls, animation, embed expansion, docs-specific styling and runtime behaviors |

That split is directionally correct. The main weakness is that the best consumer experience lives in the docs/demo layer instead of the package surface.

### What the package already gives consumers

#### Mermaid path

`MermaidRenderer.render(dag, options?)` already gives consumers:

- orientation control;
- node-id sanitization;
- terminal-annotation stripping;
- theme colors;
- container role tint overrides;
- Mermaid-safe output for Dagonizer placement types.

This is good for:

- README/docs snippets;
- static export;
- search-indexable diagrams;
- lightweight embeds where no graph runtime is wanted.

#### Cytoscape path

`CytoscapeRenderer.render(dag, options?)` and `new CytoscapeGraph(container, dag, options)` already give consumers:

- typed node/edge elements;
- placement-type metadata;
- embedded-DAG expansion via registry;
- recursive compound rendering;
- separated layout step;
- subclass hooks in `CytoscapeGraph`.

This is the real foundation for a consumer-grade DAG inspector.

### Current consumer pain points

| Pain point | Evidence in current implementation | Why it matters |
|---|---|---|
| Best UX is docs-specific | `AnimatedDagGraph` adds expand/collapse, variants, camera follow, and live animation in docs code, not package code | downstream users must rebuild the best parts themselves or copy docs internals |
| Consumer API is too primitive | package surface gives raw Mermaid strings or Cytoscape elements, but not a high-level “DAG viewer” | most users want to mount and configure a viewer, not assemble renderer + layout + stylesheet + controls manually |
| Styling is package-internal or docs-internal | core renderers expose data, but the strongest visual semantics live in docs components/stylesheets | consumers cannot easily adopt the polished visualization language without reaching into docs code |
| Parameterization is narrow | Mermaid has some theming knobs; CytoscapeGraph only exposes embedded DAGs, layout options, id mode | users cannot cleanly configure labels, grouping, filtering, badges, side panels, tooltips, state overlays, or interaction policies |
| Metadata model is renderer-oriented, not viewer-oriented | node data includes type/container/outcome/reservoir/variant-ish hooks, but there is no higher-level view-model contract | consumers need a stable extension seam for augmenting nodes/edges with domain-specific information |
| Embed story is fragmented | docs use `DagJsonMermaid`, demos use `DagGraph`, package exports the lower layers | there is no single canonical way for consumers to embed a DAG visualizer in their app or docs site |
| Static and interactive views are separate worlds | Mermaid and Cytoscape are parallel outputs with different affordances | consumers often want a single source that can produce both “printable/static” and “interactive/explorable” views consistently |

### What should be modernized

The right move is not to generalize away from Dagonizer. It is to productize the Dagonizer-specific viewer stack.

### Recommended package surface

#### 1. Introduce a first-class `DagViewer`

Expose a higher-level package primitive above `CytoscapeGraph`, for example:

~~~ts
new DagViewer(container, {
  dag,
  embeddedDAGs,
  theme,
  initialView,
  expand,
  overlays,
  interactions,
  annotations,
})
~~~

This should own:

- element composition;
- layout application;
- default stylesheet;
- zoom/pan/fit controls;
- embedded-DAG expand/collapse;
- tooltip/select/focus behavior;
- optional side-panel or event hooks.

`CytoscapeGraph` remains the low-level extension surface. `DagViewer` becomes the default consumer-facing surface.

#### 2. Introduce a stable view-model extension contract

Consumers need a supported way to enrich nodes and edges with their own semantics.

Recommended concept:

~~~ts
type DagViewAnnotation = {
  nodeBadges?: Record<string, readonly Badge[]>;
  edgeBadges?: Record<string, readonly Badge[]>;
  nodeStatus?: Record<string, 'idle' | 'active' | 'completed' | 'failed'>;
  nodeVariant?: Record<string, string>;
  groups?: Record<string, string>;
}
~~~

Or callback-based hooks:

~~~ts
type DagViewerHooks = {
  mapNode?(placement, context): Partial<DagViewNodeMeta>;
  mapEdge?(edge, context): Partial<DagViewEdgeMeta>;
}
~~~

This is better than asking consumers to subclass docs code or post-process raw elements ad hoc.

#### 3. Separate renderer output from visual policy

Today, rendering and semantics are mixed in places:

- placement type decides shape;
- container role decides tint;
- reservoir mode injects special classes;
- docs code injects variants and animation semantics.

That should become explicit policy layers:

- `DagStructureRenderer` — graph structure and canonical Dagonizer semantics;
- `DagTheme` — colors, typography, spacing, edge style, badge style;
- `DagAnnotationLayer` — runtime/domain overlays;
- `DagInteractionPolicy` — expand, hover, click, keyboard, selection, fit behavior.

That makes the viewer easier to parameterize without losing the Dagonizer model.

### Recommended consumer-facing modes

The visualizer should deliberately support three modes:

| Mode | Use case | Output |
|---|---|---|
| `static` | docs, README, export, indexing | Mermaid or static SVG/HTML representation |
| `inspect` | app UI, docs deep-dive, architecture pages | interactive graph with pan/zoom/select/expand |
| `live` | demos, execution tracing, observability | interactive graph plus runtime state overlays and event animation |

Right now the project has all three, but they are expressed through different surfaces. They should become one coherent consumer story.

### What “parameterized” should mean for Dagonizer consumers

Not arbitrary graph rendering knobs. Useful DAG-specific knobs.

#### Structural parameters

- orientation;
- embedded-DAG expansion strategy:
  - collapsed
  - selected DAGs expanded
  - all expanded
  - depth-limited
- id mode;
- gather/scatter detail level;
- whether terminal nodes are shown explicitly.

#### Visual parameters

- theme/tokens;
- compact vs detailed labels;
- node subtitle strategy;
- role tint palette;
- status palette;
- reservoir/worker styling;
- overview vs presentation mode.

#### Interaction parameters

- selectable nodes;
- click-to-expand or panel-based expand;
- keyboard navigation;
- fit behavior;
- minimap;
- fullscreen;
- hover tooltips;
- route highlighting;
- active-path follow behavior.

#### Annotation parameters

- attach source snippets;
- attach node descriptions;
- attach runtime metrics;
- attach provenance/checkpoint state;
- attach user-defined badges or tags.

These are the parameters actual Dagonizer consumers will care about.

### Concrete productization path

#### Phase A: lift docs-only features into the package

Promote the following out of docs-only code into the package-level viewer surface:

- embedded-DAG expand/collapse control;
- default control chrome (fit, zoom, pan, center);
- readable initial view strategy;
- variant/status styling hooks;
- node click and selection events.

Specifically, `AnimatedDagGraph` contains useful consumer behavior but is currently framed as docs infrastructure.

#### Phase B: define a stable `DagViewerTheme`

Expose a theme contract instead of forcing consumers to restyle Cytoscape from scratch.

Recommended theme sections:

- node type styles;
- edge styles;
- container role styles;
- status styles;
- typography;
- control chrome;
- background/grid treatment.

This should make a downstream app able to look branded without forking renderer logic.

#### Phase C: add a package-shipped UI wrapper

Ship one framework-neutral mount surface and optionally one Vue wrapper:

- core: `DagViewer`
- Vue adapter: `<DagViewer />`

The Vue wrapper should be thin and package-owned, not docs-owned.

That makes integration easy for the likely consumer base without forcing framework lock-in at the renderer layer.

#### Phase D: unify static + interactive output around one semantic core

The same normalized DAG view should drive:

- Mermaid export;
- Cytoscape interactive view;
- optional JSON model export for custom renderers.

This reduces drift and makes it easier for consumers to choose the right presentation mode.

### Recommended API shape

For downstream users of Dagonizer, the package should feel like this:

~~~ts
import {
  MermaidRenderer,
  DagViewer,
  type DagViewerOptions,
  type DagViewerTheme,
} from '@studnicky/dagonizer/viz';

const mermaid = MermaidRenderer.render(dag, {
  orientation: 'LR',
  theme: myTheme.mermaid,
});

const viewer = new DagViewer(container, {
  dag,
  embeddedDAGs,
  theme: myTheme,
  initialMode: 'inspect',
  expand: { strategy: 'selected', names: ['child-dag-a'] },
  annotations: {
    nodeStatus,
    nodeBadges,
  },
  interactions: {
    selectable: true,
    fullscreen: true,
  },
});

await viewer.mount();
~~~

That is a much better consumer story than “here are raw elements, now build your own graph product.”

### What should stay Dagonizer-specific

Do not abstract away:

- placement-type semantics;
- scatter/gather/embedded-DAG/terminal meaning;
- container-role semantics;
- reservoir semantics;
- route labels;
- recursive embedded-DAG expansion behavior.

Those are the reasons a Dagonizer visualizer is valuable.

The reusable part is not “graph drawing.” The reusable part is “high-quality visualization of Dagonizer execution topology.”

### Recommendation

The modernization direction should be:

- keep `MermaidRenderer` as the static/export layer;
- keep `CytoscapeRenderer` as the structural graph layer;
- evolve `CytoscapeGraph` into a stronger foundation;
- extract the best parts of `AnimatedDagGraph` into a package-level `DagViewer`;
- add a stable annotation/theme/interaction API for consumers;
- ship thin framework adapters rather than hiding the good viewer in docs-only code.

That would make the visualizer materially more useful to anyone adopting Dagonizer, without diluting it into a generic diagram library.

## UI kit and template recommendation

### Primary choice: PrimeVue plus an owned visual layer

Use PrimeVue for buttons, inputs, selects, menus, tabs, accordions, dialogs, drawers, overlays, tooltips, notifications, tables, trees, timelines, tags, badges, progress, and status displays.

Use PrimeVue's design-token theming only as the application layer. Define Dagonizer brand tokens above it so the product is not visually indistinguishable from a stock PrimeVue template.

Open-source sources:

| Source | Use | Fit |
|---|---|---|
| PrimeVue | canonical component implementation and API | MIT; battle-tested Vue library |
| Sakai Vue | sidebar/topbar/dashboard shell patterns | MIT; free Vue template |
| PrimeVue examples | integration and configuration patterns | MIT |
| primevue-tailwind | PrimeVue/Tailwind integration reference | MIT |
| PrimeVue showcase | authoritative usage examples | MIT repository |

Links: [PrimeVue](https://github.com/primefaces/primevue), [Sakai Vue](https://github.com/primefaces/sakai-vue), [PrimeVue examples](https://github.com/primefaces/primevue-examples), [primevue-tailwind](https://github.com/primefaces/primevue-tailwind), [PrimeVue showcase](https://github.com/primefaces/primevue/tree/master/apps/showcase).

PrimeBlocks is a separate commercial product and is not part of the open-source recommendation. Pin the PrimeVue version and test SSR/SSG output rather than copying a template's generated styles blindly.

### Secondary choice: unstyled primitives

Use [Reka UI](https://github.com/unovue/reka-ui) for low-level accessible Vue primitives where the Dagonizer visual language needs complete control. Use [shadcn-vue](https://github.com/unovue/shadcn-vue) only as an open-code pattern source, not as a remote runtime dependency.

Do not use Nuxt. Do not make the site dependent on a Nuxt module to obtain PrimeVue components.

### Not primary choices

- DaisyUI and Flowbite are useful Tailwind references, but do not provide the same Vue-first application contract as PrimeVue.
- AstroWind is an Astro/Tailwind starter reference, not the component system for this project.
- Community Starlight themes can inform documentation styling, but should be evaluated as plugins and CSS references rather than merged wholesale.

## Visual system

The logo palette should become semantic tokens:

~~~css
:root {
  --brand-bg: #04060a;
  --brand-surface: #0e1525;
  --brand-surface-strong: #020306;
  --brand-text: #eef3f7;
  --brand-text-muted: #c9d0d8;
  --brand-text-subtle: #7a8290;
  --brand-cyan: #22e8ff;
  --brand-violet: #8f6dff;
  --brand-gold: #d4a649;
}
~~~

Use cyan for navigation focus, links, primary actions, and active graph edges; violet for secondary modes and selected states; gold for warnings, provenance, and deliberate emphasis. Keep backgrounds and surfaces quiet. Avoid using all three accents on every card.

Rules:

- high information density with generous grouping and alignment;
- one strong display treatment for marketing headings and a dependable readable face for docs;
- monospace only for code, identifiers, metrics, and technical labels;
- thin borders, precise spacing, controlled radii, and restrained glow;
- motion that communicates hierarchy or state;
- prefers-reduced-motion as a first-class state;
- no selectors coupled to Starlight or VitePress internals in shared tokens.

## Migration plan

### Phase 0: freeze the contract

Record current routes, canonical URLs, generated assets, frontmatter fields, sidebar groups, snippet checks, structured-data outputs, and demo entrypoints. Add a route inventory test comparing existing output with experiment output. Production VitePress remains published.

### Phase 1: create the isolated Astro experiment

Create a separate site package with Astro and Starlight, shared token CSS, a new header/top bar/sidebar contract, one landing page, one representative documentation page, and one lightweight Vue island. Do not edit current VitePress routes.

Acceptance: the new home page looks modern without inheriting VitePress selectors, and the docs page uses the same brand tokens without adopting the marketing layout.

### Phase 2: validate PrimeVue boundaries

Build a component lab containing the controls required by the demos: tabbed panes, status badges, buttons, dialogs, trace rows, tables, graph legend controls, and responsive navigation. Test static generation and hydration for flash of unstyled content, hydration mismatch, focus loss, and bundle growth.

### Phase 3: migrate content without visual coupling

Move content collections in groups: getting started/concepts, guides, examples, reference, then architecture/validation/generated feeds and machine-readable outputs. Keep text and source snippets stable while replacing only the shell. Preserve redirects for changed URLs.

### Phase 4: move demos into explicit applications/islands

Finish the example app boundaries first. A demo page renders a static explanation and clear loading state, then loads its Vue application on interaction or when it enters the viewport. Worker registries and browser providers stay in the application package.

### Phase 5: compare and decide

Compare route/link parity, metadata, mobile navigation, keyboard behavior, reduced motion, LCP/CLS/INP, JavaScript transferred on docs pages, demo startup/failure states, build reproducibility, and visual treatment.

Only after those gates pass should the deployment target change.

## Risks and open decisions

| Risk | Why it matters | Required test |
|---|---|---|
| PrimeVue SSR/SSG styling | CSS can flash or diverge during hydration | static-build plus browser smoke test |
| Demo bundle size | Cytoscape, Mermaid, and LLM assets are expensive | per-route budgets and interaction loading |
| Worker URLs | Astro paths differ from Vite assumptions | production preview test for every worker demo |
| Search and metadata parity | easy to lose local search, canonical tags, RSS, or JSON-LD during migration | artifact diff plus head-tag assertions |
| GitHub Pages base path | current site is under /Dagonizer/ | build and click-test exact base path |
| Starlight customization depth | too many overrides recreate coupling | configuration/custom CSS first |
| Content migration | changed slugs break references and search | route inventory and redirect map |
| Shared component ownership | docs and demos need different density | separate marketing/docs/application dirs |
| Motion accessibility | scroll-heavy pages can exclude users | reduced-motion and keyboard review |

The first technical spike should answer:

1. Can Starlight carry the current docs taxonomy while the custom header/sidebar and palette remain clean?
2. Can a PrimeVue island hydrate without style flash or pulling the full demo/runtime bundle into a docs page?

## Definition of done

- Current VitePress remains the published site.
- The Astro experiment has home, docs, and demo-launch routes under the GitHub Pages base path.
- Logo colors are semantic tokens used consistently.
- Top bar, navigation, mobile menu, sidebar, footer, and transitions have explicit ownership.
- At least one PrimeVue application component and one Vue demo island render from a static Astro page.
- Build output has no hydration warnings, broken worker URLs, missing metadata, or missing machine-readable artifacts.
- Existing docs and runnable examples remain source-backed.
- Search, feed, sitemap, `llms.txt`, icons, manifest, and page-level structured data are verified against the current site contract.
- A visual comparison and performance report exists before any production switch.

## Completion audit

Against the thread objective, the work is not yet complete.

What is already satisfied by current evidence:

- the current docs/GitHub Pages contract is inventoried at route, asset, metadata, shell, and demo-runtime levels;
- the modernization proposal assigns future ownership for those responsibilities;
- the proposal includes acceptance criteria and CI-oriented verification patterns;
- the current repository proves buildability, emitted route coverage, sitemap coverage, feed/public-file presence, and representative page metadata/output.

What is still not satisfied strongly enough to mark the objective complete:

- mobile and keyboard shell behavior are not browser-verified;
- local-search interaction is not browser-verified;
- live demo runtime behavior is not browser-verified;
- the modernization proposal therefore still has three remaining indirect proof rows, now enumerated as explicit runtime-verification work.

Required evidence before the thread goal can honestly be marked complete:

1. A browser-driven verification pass against the current site covering shell interaction, search interaction, and at least one live demo route.
2. The resulting findings folded back into this audit so those remaining `indirect` rows become either `proven` or explicit known gaps with concrete failure details.
3. A final requirement-by-requirement check confirming no current GitHub Pages responsibility remains unaccounted for.

Until then, this document is a near-complete proof surface, not a complete proof.

## Sources and repository evidence

Local evidence:

- [package.json](package.json) — VitePress scripts and docs validation contract.
- [docs/.vitepress/config.ts](docs/.vitepress/config.ts) — metadata, nav, sidebar, Mermaid, aliases, and build configuration.
- [docs/.vitepress/theme/index.ts](docs/.vitepress/theme/index.ts) — custom layout slots and async Vue registration.
- [docs/.vitepress/theme/components/TopBar.vue](docs/.vitepress/theme/components/TopBar.vue) — custom top bar and navigation state.
- [docs/.vitepress/theme/base.css](docs/.vitepress/theme/base.css) — global visual overrides and brand treatment.
- [docs/index.md](docs/index.md) — current product landing content.
- [docs/experiments/modern-home.md](docs/experiments/modern-home.md) — current isolated visual experiment route.
- [docs/examples/the-archivist.md](docs/examples/the-archivist.md), [docs/examples/the-cartographer.md](docs/examples/the-cartographer.md), and [docs/examples/the-dispatcher.md](docs/examples/the-dispatcher.md) — demo entry pages.
- [scripts/docs-build.mjs](scripts/docs-build.mjs) — render-failure gate around the VitePress production build.
- [docs/public/llms.txt](docs/public/llms.txt) and [docs/public/manifest.webmanifest](docs/public/manifest.webmanifest) — machine-readable and installable-site artifacts.

External references:

- [VitePress](https://vitepress.dev/guide/what-is-vitepress) and [custom themes](https://vitepress.dev/guide/custom-theme).
- [Astro islands](https://docs.astro.build/en/concepts/islands/).
- [Starlight](https://starlight.astro.build/), [custom pages](https://starlight.astro.build/guides/pages/), [component overrides](https://starlight.astro.build/guides/overriding-components/), and [custom CSS](https://starlight.astro.build/guides/css-and-tailwind/).
- [PrimeVue](https://github.com/primefaces/primevue), [Sakai Vue](https://github.com/primefaces/sakai-vue), [PrimeVue examples](https://github.com/primefaces/primevue-examples), and [primevue-tailwind](https://github.com/primefaces/primevue-tailwind).
- [Reka UI](https://github.com/unovue/reka-ui) and [shadcn-vue](https://github.com/unovue/shadcn-vue) as unstyled/open-code alternatives.
