<script setup lang="ts">
/**
 * DocFooter — canonical "See also" + "Next steps" footer for every
 * doc page. Reads `seeAlso` and `nextSteps` arrays from the page's
 * frontmatter; renders nothing if both are absent.
 *
 * Each entry is `{ text: string; link: string; description?: string }`.
 * Pages declare their cross-references in frontmatter instead of
 * hand-typed "## See also" / "## Next steps" sections, so the rendering
 * stays consistent across the site.
 */

import { computed } from 'vue';
import { useData } from 'vitepress';

interface FooterLink {
  readonly text:        string;
  readonly link:        string;
  readonly description?: string;
}

const { frontmatter } = useData();

const seeAlso   = computed<readonly FooterLink[]>(() => frontmatter.value['seeAlso']   ?? []);
const nextSteps = computed<readonly FooterLink[]>(() => frontmatter.value['nextSteps'] ?? []);

const hasFooter = computed(() => seeAlso.value.length > 0 || nextSteps.value.length > 0);
</script>

<template>
  <footer v-if="hasFooter" class="dagonizer-doc-footer">
    <section v-if="nextSteps.length > 0" class="footer-section">
      <h2 class="footer-title">Next steps</h2>
      <ul class="footer-list">
        <li v-for="item in nextSteps" :key="item.link">
          <a :href="item.link" class="footer-link">{{ item.text }}</a>
          <span v-if="item.description" class="footer-desc"> — {{ item.description }}</span>
        </li>
      </ul>
    </section>

    <section v-if="seeAlso.length > 0" class="footer-section">
      <h2 class="footer-title">See also</h2>
      <ul class="footer-list">
        <li v-for="item in seeAlso" :key="item.link">
          <a :href="item.link" class="footer-link">{{ item.text }}</a>
          <span v-if="item.description" class="footer-desc"> — {{ item.description }}</span>
        </li>
      </ul>
    </section>
  </footer>
</template>

<style scoped>
.dagonizer-doc-footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--vp-c-divider);
  display: grid;
  gap: 2rem;
}

.footer-section { display: block; }

.footer-title {
  font-family: var(--vp-font-family-display);
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dagonizer-seagreen, var(--vp-c-brand-1));
  margin: 0 0 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.78rem;
}

.footer-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.35rem;
}

.footer-list li::before {
  content: "⦿";
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  margin-right: 0.55rem;
  font-size: 0.85em;
}

.footer-link {
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  font-weight: 500;
  text-decoration: none;
}

.footer-link:hover {
  color: var(--dagonizer-gold, var(--vp-c-brand-2));
  text-decoration: underline;
}

.footer-desc {
  color: var(--vp-c-text-2);
  font-size: 0.92em;
}
</style>
