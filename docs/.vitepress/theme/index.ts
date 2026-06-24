import { withBase, type Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client'
import '@shikijs/vitepress-twoslash/style.css'
import { h, defineAsyncComponent } from 'vue'
import { MermaidExplorer } from '@studnicky/dagonizer/viz'
import '@studnicky/dagonizer/viz/explorer.css'
import './palette.css'
import './base.css'

import TopBar from './components/TopBar.vue'
import HomeHero from './components/HomeHero.vue'
import DocFooter from './components/DocFooter.vue'

// ArchivistRunner is heavy (cytoscape + fcose + LLM provider matrix);
// lazy-load so doc pages that don't embed it don't pay for the bundle.
const ArchivistRunner = defineAsyncComponent(() =>
  import('./components/ArchivistRunner.vue'),
)

// CartographerRunner: deterministic data-orchestration demo (no LLM).
// Lazy-loaded for the same reason as ArchivistRunner.
const CartographerRunner = defineAsyncComponent(() =>
  import('./components/CartographerRunner.vue'),
)

// DispatcherRunner: HITL park-and-correlate demo (no LLM, deterministic).
// Lazy-loaded for the same reason as ArchivistRunner.
const DispatcherRunner = defineAsyncComponent(() =>
  import('./components/DispatcherRunner.vue'),
)

// DagGraph renders any Dagonizer DAG via cytoscape. Lazy-load: only doc
// pages with a <DagGraph :elements="..." /> block pull the bundle.
const DagGraph = defineAsyncComponent(() =>
  import('./components/DagGraph.vue'),
)

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchivistRunner', ArchivistRunner)
    app.component('CartographerRunner', CartographerRunner)
    app.component('DispatcherRunner', DispatcherRunner)
    app.component('DagGraph', DagGraph)
    app.use(TwoslashFloatingVue)
    // Mermaid diagrams get the same D-pad + fullscreen explorer as the graph
    // canvases, straight from the package. Client-only; install() wires a
    // MutationObserver for async-rendered SVGs and is a no-op without a DOM.
    if (typeof window !== 'undefined') MermaidExplorer.install()
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      // TopBar owns the left navbar zone (sidebar toggle + brand);
      // the default VPNavBarTitle is hidden in base.css.
      'nav-bar-content-before': () => h(TopBar),
      // HomeHero renders the hero + features grid from frontmatter
      // when present. The home page uses layout: doc so it gets the
      // canonical sidebar/topbar/footer chrome that every page uses.
      'doc-before': () => h(HomeHero),
      // DocFooter renders the seeAlso + nextSteps frontmatter arrays.
      'doc-after': () => h(DocFooter),
      'sidebar-nav-before': () =>
        h('div', { class: 'dagonizer-sidebar-icon' }, [
          h('img', {
            src: withBase('/dagonizer-icon.svg'),
            alt: 'Dagonizer',
          }),
        ]),
    })
  },
} satisfies Theme
