import { withBase, type Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { h, defineAsyncComponent } from 'vue'
import './palette.css'
import './base.css'

import SidebarToggle from './components/SidebarToggle.vue'

// ArchivistRunner is heavy (cytoscape + fcose + LLM provider matrix);
// lazy-load so doc pages that don't embed it don't pay for the bundle.
const ArchivistRunner = defineAsyncComponent(() =>
  import('./components/ArchivistRunner.vue'),
)

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchivistRunner', ArchivistRunner)
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      // Toggle button mounted into the navbar — collapses / re-opens the
      // page-tree drawer at every viewport.
      'nav-bar-content-after': () => h(SidebarToggle),
      'sidebar-nav-before': () =>
        h('div', { class: 'dagonizer-sidebar-icon' }, [
          // <img> renders the SVG with native transparency. The src is
          // base-aware via withBase so it resolves under the configured
          // VitePress base (e.g. /Dagonizer/dagonizer-icon.svg on GH Pages).
          h('img', {
            src: withBase('/dagonizer-icon.svg'),
            alt: 'Dagonizer',
          }),
        ]),
    })
  },
} satisfies Theme
