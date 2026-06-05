import { withBase, type Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { h, defineAsyncComponent } from 'vue'
import './palette.css'
import './base.css'

import TopBar from './components/TopBar.vue'
import HomeHero from './components/HomeHero.vue'
import DocFooter from './components/DocFooter.vue'
import MermaidGate from './components/MermaidGate.vue'

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
    app.component('DagGraph', DagGraph)
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
      // MermaidGate enhances diagrams after the page mounts.
      'doc-after': () => [h(DocFooter), h(MermaidGate)],
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
