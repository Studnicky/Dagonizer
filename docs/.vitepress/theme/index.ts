import { withBase, type Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client'
import '@shikijs/vitepress-twoslash/style.css'
import { h, defineAsyncComponent } from 'vue'
import { MermaidExplorer } from '@studnicky/dagonizer/viz'
import '@studnicky/dagonizer/viz/Dpad.css'
import '@studnicky/dagonizer/viz/ModalShell.css'
import '@studnicky/dagonizer/viz/CodeSample.css'
import '@studnicky/dagonizer/viz/ViewerActions.css'
import '@studnicky/dagonizer/viz/ViewerOverlay.css'
import '@studnicky/dagonizer/viz/explorer.css'
import './palette.css'
import './base.css'

import { CodeSampleChrome } from './codeSamples'
import TopBar from './components/TopBar.vue'
import HomeHero from './components/HomeHero.vue'
import ExperimentalHomeHero from './components/ExperimentalHomeHero.vue'
import DocFooter from './components/DocFooter.vue'
import UiCallout from './components/ui/UiCallout.vue'
import UiCodeTabs from './components/ui/UiCodeTabs.vue'
import RunnableExampleRunner from '../../../site/src/components/islands/RunnableExampleRunner.vue'

// DagGraph renders any Dagonizer DAG via cytoscape. Lazy-load: only doc
// pages with a <DagGraph :elements="..." /> block pull the bundle.
const DagGraph = defineAsyncComponent(() =>
  import('./components/DagGraph.vue'),
)

// DagJsonMermaid pairs the registered JSON-LD DAG document with the Mermaid
// source rendered from that same document.
const DagJsonMermaid = defineAsyncComponent(() =>
  import('./components/DagJsonMermaid.vue'),
)

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('RunnableExampleRunner', RunnableExampleRunner)
    app.component('DagGraph', DagGraph)
    app.component('DagJsonMermaid', DagJsonMermaid)
    app.component('ExperimentalHomeHero', ExperimentalHomeHero)
    app.component('UiCallout', UiCallout)
    app.component('UiCodeTabs', UiCodeTabs)
    app.use(TwoslashFloatingVue)
    // Mermaid diagrams get the same D-pad + fullscreen explorer as the graph
    // canvases, straight from the package. Client-only; install() wires a
    // MutationObserver for async-rendered SVGs and is a no-op without a DOM.
    if (typeof window !== 'undefined') {
      MermaidExplorer.install()
      CodeSampleChrome.install()
    }
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      // TopBar owns the left navbar title zone (sidebar toggle + brand);
      // the default VPNavBarTitle is hidden in base.css.
      'nav-bar-title-before': () => h(TopBar),
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
