import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './palette.css'
import './base.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () =>
        h('div', { class: 'dagonizer-sidebar-icon' }, [
          // <img> renders the SVG with native transparency. <object>
          // paints a default white backdrop while loading and on some
          // platforms keeps it after — switch to img to guarantee the
          // sidebar shows through the talisman.
          h('img', {
            src: '/dagonizer-icon.svg',
            alt: 'Dagonizer',
          }),
        ]),
    })
  },
} satisfies Theme
